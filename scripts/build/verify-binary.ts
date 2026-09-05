#!/usr/bin/env node
/**
 * Build-time CLI, run by ninja as validations of bun's link edge:
 *
 *   verify-binary.ts binary <spec.json>
 *       Static scans of the linked executable against the expectations
 *       configure wrote into <spec.json> (see binary-expectations.ts):
 *       exported symbols, dynamic libraries + symbol-version ceilings,
 *       forbidden imports, static initializers, hardening bits, debug info.
 *
 *   verify-binary.ts duplicates <nm> <rspfile> <report>
 *       Every object and archive on bun's link line, scanned for a symbol
 *       with two strong external definitions (the linker picks one silently
 *       when the other sits in an archive member it never loads). <report>
 *       also lists weak definitions whose sizes disagree across objects —
 *       the usual face of an ODR violation — without failing on them.
 *
 * Everything is read with the LLVM binutils the build already requires
 * (llvm-nm / llvm-readobj / llvm-objdump), so ELF, Mach-O and PE are all
 * checked from whatever host links them. One line per check on stdout
 * (`stream.ts` prefixes them `[check]`); violations listed under the line
 * that failed; exit 1 if any did.
 */

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import type { BinaryExpectations } from "./binary-expectations.ts";
import { BuildError, assert } from "./error.ts";

export interface VerifySpec {
  /** Display name (`bun-profile`). */
  name: string;
  exe: string;
  tools: { nm: string; readobj: string; objdump: string; cxxfilt: string };
  expect: BinaryExpectations;
}

// ───────────────────────────────────────────────────────────────────────────
// Plumbing
// ───────────────────────────────────────────────────────────────────────────

function run(tool: string, args: string[]): string {
  const r = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error) throw new BuildError(`failed to run ${tool}`, { cause: r.error });
  if (r.status !== 0) throw new BuildError(`${tool} ${args.join(" ")} exited ${r.status}:\n${r.stderr}`);
  return r.stdout;
}

/** Demangle Itanium names (index-aligned with the input; non-mangled names pass through). */
function demangle(cxxfilt: string, names: string[]): string[] {
  if (names.length === 0) return [];
  const r = spawnSync(cxxfilt, [], { input: names.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new BuildError(`failed to run ${cxxfilt}`, { cause: r.error });
  const out = r.stdout.split("\n");
  return names.map((n, i) => out[i] ?? n);
}

/** `*`-wildcard match (whole string). */
function globToRegExp(patterns: string[]): RegExp {
  if (patterns.length === 0) return /(?!)/;
  const alt = patterns.map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).join("|");
  return new RegExp(`^(?:${alt})$`);
}

function versionLeq(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

interface CheckResult {
  name: string;
  summary: string;
  violations: string[];
}
const results: CheckResult[] = [];
function report(name: string, summary: string, violations: string[] = []): void {
  results.push({ name, summary, violations });
}

/** Compare a found set against an expected set: extras are always violations, absentees only when `exact`. */
function setDifference(
  found: Iterable<string>,
  expected: Iterable<string>,
  exact = true,
  normalize = (s: string) => s,
): string[] {
  const f = new Map([...found].map(s => [normalize(s), s]));
  const e = new Map([...expected].map(s => [normalize(s), s]));
  return [
    ...[...f].filter(([k]) => !e.has(k)).map(([, v]) => `+ ${v} (not expected)`),
    ...(exact ? [...e].filter(([k]) => !f.has(k)).map(([, v]) => `- ${v} (expected, absent)`) : []),
  ];
}

/** `llvm-readobj` LLVM-style output → the `{ ... }` blocks that start with `<kind> {`. */
function blocks(text: string, kind: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s*)(\S+) \{\s*$/);
    if (!m || m[2] !== kind) continue;
    const indent = m[1]!.length;
    let j = i + 1;
    while (j < lines.length && !(lines[j]!.startsWith(" ".repeat(indent) + "}") && lines[j]!.trim() === "}")) j++;
    out.push(lines.slice(i + 1, j).join("\n"));
    i = j;
  }
  return out;
}
const field = (block: string, key: string): string | undefined =>
  block.match(new RegExp(`^\\s*${key}: (.*)$`, "m"))?.[1]?.trim();
/** Names inside every `<listKey> [ … ]` list of a readobj block. */
const flagNames = (block: string, listKey: string): string[] => {
  const out: string[] = [];
  for (const m of block.matchAll(new RegExp(`${listKey} \\[[^\\]]*\\]`, "gs")))
    for (const x of m[0].matchAll(/^\s+([A-Z][A-Z0-9_]+)(?: \(0x[0-9A-Fa-f]+\))?\s*$/gm)) out.push(x[1]!);
  return out;
};

/** `llvm-objdump --macho --private-headers` → one text block per load command. */
const loadCommands = (priv: string): { cmd: string; text: string }[] =>
  priv
    .split(/^Load command \d+\s*$/m)
    .slice(1)
    .map(text => ({ cmd: text.match(/^\s*cmd (\S+)/m)?.[1] ?? "", text }));

/** Symbol table as address-sorted [addr, name] for symbolizing initializer pointers. */
function symbolTable(nm: string, exe: string): { lookup(addr: bigint): string | undefined; size: number } {
  const text = run(nm, ["--defined-only", "--numeric-sort", "--no-demangle", exe]);
  const addrs: bigint[] = [];
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([0-9a-fA-F]+) \S (.+)$/);
    if (!m) continue;
    addrs.push(BigInt("0x" + m[1]!));
    names.push(m[2]!);
  }
  const exact = new Map<bigint, string>();
  for (let i = 0; i < addrs.length; i++) if (!exact.has(addrs[i]!)) exact.set(addrs[i]!, names[i]!);
  return { lookup: a => exact.get(a) ?? exact.get(a & ~1n), size: addrs.length };
}

function readAt(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, offset);
    return buf;
  } finally {
    closeSync(fd);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// ELF
// ───────────────────────────────────────────────────────────────────────────

function verifyElf(spec: VerifySpec): void {
  const { nm, readobj } = spec.tools;
  const { exe, expect } = spec;
  const info = run(readobj, [
    "--file-header",
    "--program-headers",
    "--sections",
    "--dynamic-table",
    "--needed-libs",
    "--version-info",
    exe,
  ]);

  // 1. exports (`name@@VERSION` → name; demangled separately, index-aligned,
  // for a version script's `extern "C++"` patterns)
  const dynsyms = run(nm, ["--dynamic", "--defined-only", "--extern-only", "--no-demangle", exe])
    .split("\n")
    .map(l => l.match(/^([0-9a-fA-F]+) \S (.+?)(?:@@?[A-Za-z0-9_.]+)?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => ({ addr: BigInt("0x" + m[1]!), name: m[2]! }));
  const exported = dynsyms.map(d => d.name);
  {
    const demangled = demangle(spec.tools.cxxfilt, exported);
    const exact = new Set(expect.exports.exact);
    const pat = globToRegExp(expect.exports.patterns);
    const dpat = globToRegExp(expect.exports.demangledPatterns);
    // A non-PIE executable "defines" the libc data it touches (environ,
    // stdout, tzname …) through copy relocations; those are libc's exports,
    // not ours.
    const copyRelocated = new Set(
      blocks(run(readobj, ["--dyn-relocations", "--expand-relocs", exe]), "Relocation")
        .filter(b => /_COPY\b/.test(field(b, "Type") ?? ""))
        .map(b => BigInt(field(b, "Offset")!)),
    );
    const bad = exported.filter(
      (s, i) => !exact.has(s) && !pat.test(s) && !dpat.test(demangled[i] ?? "") && !copyRelocated.has(dynsyms[i]!.addr),
    );
    report(
      "exports",
      `${exported.length} dynamic symbols${copyRelocated.size ? ` (${copyRelocated.size} libc copy relocations)` : ""}`,
      bad.map(s => `+ ${s} (not in the export list)`),
    );
  }

  // 2. needed libs + symbol version ceilings
  {
    const needed = (info.match(/NeededLibraries \[([^\]]*)\]/)?.[1] ?? "")
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const violations = setDifference(needed, expect.neededLibs.names, expect.neededLibs.exact);
    // Only what we *require* (verneed), not the versions we define (verdef).
    const verneed = info.match(/VersionRequirements \[[\s\S]*?\n\]/)?.[0] ?? "";
    const maxSeen = new Map<string, string>();
    for (const m of verneed.matchAll(/Name: ([A-Za-z+]+)_([0-9][0-9.]*)\s*$/gm)) {
      const [, prefix, ver] = m as unknown as [string, string, string];
      const cur = maxSeen.get(prefix);
      if (cur === undefined || !versionLeq(ver, cur)) maxSeen.set(prefix, ver);
    }
    if (expect.maxSymbolVersions !== undefined) {
      for (const [prefix, ver] of maxSeen) {
        const ceiling = expect.maxSymbolVersions[prefix];
        if (ceiling === undefined) violations.push(`+ ${prefix}_${ver} (no ${prefix} versioned imports expected)`);
        else if (!versionLeq(ver, ceiling))
          violations.push(`${prefix}_${ver} required, ceiling is ${prefix}_${ceiling}`);
      }
    }
    const vers = [...maxSeen].map(([p, v]) => `${p}_${v}`).join(" ");
    report("dynamic libraries", `${needed.join(" ")}${vers ? `; max ${vers}` : ""}`, violations);
  }

  // 3. forbidden imports
  const imported = run(nm, ["--dynamic", "--undefined-only", "--format=just-symbols", "--no-demangle", exe])
    .split("\n")
    .map(s => s.replace(/@.*$/, ""))
    .filter(s => s.length > 0);
  {
    const pat = globToRegExp(expect.forbiddenImports);
    const bad = imported.filter(s => pat.test(s));
    report(
      "imports",
      `${imported.length} undefined dynamic symbols`,
      bad.map(s => `+ ${s} (forbidden import)`),
    );
  }

  const sections = blocks(info, "Section");
  const section = (name: string) =>
    sections.find(b => field(b, "Name")?.startsWith(name + " ") || field(b, "Name") === name);

  // 4. static initializers
  if (expect.staticInitializers !== undefined) {
    const violations: string[] = [];
    const names: string[] = [];
    const init = section(".init_array");
    if (init !== undefined) {
      const size = Number(field(init, "Size"));
      const offset = Number(field(init, "Offset"));
      const addr = BigInt(field(init, "Address")!);
      const isDyn = /Type: SharedObject/.test(info);
      let ptrs: bigint[] = [];
      const raw = readAt(exe, offset, size);
      for (let i = 0; i + 8 <= size; i += 8) ptrs.push(raw.readBigUInt64LE(i));
      if (isDyn) {
        // PIE: the slots are filled by R_*_RELATIVE relocations; take the addends.
        const rel = run(readobj, ["--relocations", "--expand-relocs", exe]);
        const addends = new Map<bigint, bigint>();
        for (const b of blocks(rel, "Relocation")) {
          // RELR-packed entries carry their addend in place (no Addend field):
          // the raw slot value is already the link-time address.
          const addend = field(b, "Addend");
          if (!/RELATIVE/.test(field(b, "Type") ?? "") || addend === undefined) continue;
          addends.set(BigInt(field(b, "Offset")!), BigInt(addend));
        }
        ptrs = ptrs.map((p, i) => addends.get(addr + BigInt(8 * i)) ?? p);
      }
      const syms = symbolTable(nm, exe);
      const allowed = globToRegExp(expect.staticInitializers);
      for (const p of ptrs) {
        const name = syms.lookup(p) ?? `0x${p.toString(16)}`;
        names.push(name);
        if (!allowed.test(name)) violations.push(`+ ${name} (new static initializer)`);
      }
    }
    report("static initializers", `${names.length}${names.length ? ` (${names.join(", ")})` : ""}`, violations);
  }

  // 5. hardening
  if (expect.elf !== undefined) {
    const violations: string[] = [];
    const type = /Type: SharedObject/.test(info) ? "DYN" : /Type: Executable/.test(info) ? "EXEC" : "?";
    if (type !== expect.elf.type) violations.push(`ELF type ${type}, expected ${expect.elf.type}`);
    const phdrs = blocks(info, "ProgramHeader");
    const flagsOf = (b: string) => flagNames(b, "Flags");
    const stack = phdrs.find(b => /PT_GNU_STACK/.test(field(b, "Type") ?? ""));
    if (stack === undefined || flagsOf(stack).includes("PF_X")) violations.push("PT_GNU_STACK missing or executable");
    for (const b of phdrs) {
      if (!/PT_LOAD/.test(field(b, "Type") ?? "")) continue;
      const f = flagsOf(b);
      if (f.includes("PF_W") && f.includes("PF_X")) violations.push(`PT_LOAD at ${field(b, "VirtualAddress")} is RWX`);
    }
    const relro = phdrs.some(b => /PT_GNU_RELRO/.test(field(b, "Type") ?? ""));
    if (relro !== expect.elf.relro)
      violations.push(
        `PT_GNU_RELRO ${relro ? "present" : "absent"}, expected ${expect.elf.relro ? "present" : "absent"}`,
      );
    const bindNow = /BIND_NOW|\bNOW\b/.test(info.match(/DynamicSection \[[\s\S]*?\n\]/)?.[0] ?? "");
    if (bindNow !== expect.elf.bindNow) violations.push(`BIND_NOW ${bindNow}, expected ${expect.elf.bindNow}`);
    report("hardening", `${type}, nx-stack, no rwx${relro ? ", relro" : ""}${bindNow ? ", bind-now" : ""}`, violations);
  }

  // 8. debug info / symtab
  if (expect.debugInfo !== undefined) {
    const violations: string[] = [];
    const symtab = section(".symtab") !== undefined;
    const debug = sections.filter(b => (field(b, "Name") ?? "").startsWith(".debug_"));
    const compressed = debug.length > 0 && debug.every(b => flagNames(b, "Flags").includes("SHF_COMPRESSED"));
    if (symtab !== expect.debugInfo.symtab) violations.push(`.symtab ${symtab ? "present" : "absent"}`);
    if (debug.length > 0 !== expect.debugInfo.debugSections)
      violations.push(`.debug_* ${debug.length > 0 ? "present" : "absent"}`);
    if (expect.debugInfo.debugSections && compressed !== expect.debugInfo.compressed)
      violations.push(
        `.debug_* ${compressed ? "compressed" : "uncompressed"}, expected ${expect.debugInfo.compressed ? "compressed" : "uncompressed"}`,
      );
    report(
      "debug info",
      `${symtab ? "symtab" : "no symtab"}, ${debug.length} debug sections${compressed ? " (compressed)" : ""}`,
      violations,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Mach-O
// ───────────────────────────────────────────────────────────────────────────

function verifyMachO(spec: VerifySpec): void {
  const { nm, readobj, objdump } = spec.tools;
  const { exe, expect } = spec;
  const priv = run(objdump, ["--macho", "--private-headers", exe]);

  // 1. exports (the export trie is what dyld resolves against)
  {
    const trie = run(objdump, ["--macho", "--exports-trie", exe]);
    const exported = [...trie.matchAll(/^0x[0-9A-Fa-f]+\s+(\S+)/gm)].map(m => m[1]!);
    const exact = new Set(expect.exports.exact);
    const pat = globToRegExp(expect.exports.patterns);
    // dyld's own entry points every executable exports.
    const builtin = new Set(["__mh_execute_header", "_main"]);
    const bad = exported.filter(s => !exact.has(s) && !pat.test(s) && !builtin.has(s));
    report(
      "exports",
      `${exported.length} exported symbols`,
      bad.map(s => `+ ${s} (not in the export list)`),
    );
  }

  const cmds = loadCommands(priv);

  // 2. dylibs + minos
  {
    const dylibs = cmds
      .filter(c => /^LC_(LOAD|LOAD_WEAK|REEXPORT|LOAD_UPWARD|LAZY_LOAD)_DYLIB$/.test(c.cmd))
      .map(c => c.text.match(/^\s+name (\S+) \(offset \d+\)$/m)?.[1] ?? "?");
    const uniq = [...new Set(dylibs)];
    const violations = setDifference(uniq, expect.neededLibs.names, expect.neededLibs.exact);
    const minos = priv.match(/^\s+minos ([0-9.]+)/m)?.[1];
    if (expect.minOSVersion !== undefined && minos !== expect.minOSVersion)
      violations.push(`minos ${minos}, expected ${expect.minOSVersion}`);
    report("dynamic libraries", `${uniq.map(s => s.replace(/^.*\//, "")).join(" ")}; minos ${minos}`, violations);
  }

  // 3. forbidden imports
  {
    const imported = run(nm, ["--undefined-only", "--format=just-symbols", "--no-demangle", exe])
      .split("\n")
      .filter(s => s.length > 0);
    const pat = globToRegExp(expect.forbiddenImports.map(p => (p.startsWith("_") ? p : `_${p}`)));
    const bad = imported.filter(s => pat.test(s));
    report(
      "imports",
      `${imported.length} undefined symbols`,
      bad.map(s => `+ ${s} (forbidden import)`),
    );
  }

  // 4. static initializers: __mod_init_func (pointers) or __init_offsets
  // (32-bit offsets from the __TEXT segment, the chained-fixups form).
  if (expect.staticInitializers !== undefined) {
    const secs = blocks(run(readobj, ["--sections", exe]), "Section");
    const names: string[] = [];
    const violations: string[] = [];
    const textBase = BigInt(
      loadCommands(priv)
        .find(c => c.cmd === "LC_SEGMENT_64" && /^\s+segname __TEXT$/m.test(c.text))
        ?.text.match(/^\s+vmaddr (0x[0-9a-f]+)/m)?.[1] ?? "0x100000000",
    );
    const syms = symbolTable(nm, exe);
    const allowed = globToRegExp(
      expect.staticInitializers.map(p => (p.startsWith("_") ? `_${p}` : `_${p}`)).concat(expect.staticInitializers),
    );
    for (const b of secs) {
      const name = field(b, "Name")?.replace(/ \(.*$/, "");
      if (name !== "__init_offsets" && name !== "__mod_init_func") continue;
      const size = Number(field(b, "Size"));
      const offset = Number(field(b, "Offset"));
      const raw = readAt(exe, offset, size);
      const ptrs: bigint[] = [];
      if (name === "__init_offsets")
        for (let i = 0; i + 4 <= size; i += 4) ptrs.push(textBase + BigInt(raw.readUInt32LE(i)));
      else for (let i = 0; i + 8 <= size; i += 8) ptrs.push(raw.readBigUInt64LE(i) & 0xfffffffffffn);
      for (const p of ptrs) {
        const sym = syms.lookup(p) ?? `0x${p.toString(16)}`;
        names.push(sym);
        if (!allowed.test(sym)) violations.push(`+ ${sym} (new static initializer)`);
      }
    }
    report("static initializers", `${names.length}${names.length ? ` (${names.join(", ")})` : ""}`, violations);
  }

  // 5. hardening: header flags + segment protections
  if (expect.macho !== undefined) {
    const violations: string[] = [];
    const header = run(objdump, ["--macho", "--private-header", exe]);
    const flagLine = header.split("\n").find(l => /EXECUTE/.test(l)) ?? "";
    for (const f of expect.macho.flags)
      if (!new RegExp(`\\b${f}\\b`).test(flagLine)) violations.push(`MH_${f} not set`);
    const segs = cmds
      .filter(c => c.cmd === "LC_SEGMENT_64")
      .map(
        c =>
          [
            c.text.match(/^\s+segname (\S+)/m)?.[1] ?? "?",
            c.text.match(/^\s+maxprot ([rwx-]{3})/m)?.[1] ?? "?",
          ] as const,
      );
    const seen: string[] = [];
    for (const [segname, maxprot] of segs) {
      const want = expect.macho.segmentMaxProt[segname];
      seen.push(`${segname}=${maxprot}`);
      if (want !== undefined && want !== maxprot) violations.push(`${segname} maxprot ${maxprot}, expected ${want}`);
      if (/w/.test(maxprot) && /x/.test(maxprot)) violations.push(`${segname} is RWX`);
    }
    report("hardening", `${flagLine.trim().split(/\s+/).slice(7).join(" ")}; ${seen.join(" ")}`, violations);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PE/COFF
// ───────────────────────────────────────────────────────────────────────────

function verifyPE(spec: VerifySpec): void {
  const { readobj } = spec.tools;
  const { exe, expect } = spec;

  // 1. exports
  {
    const text = run(readobj, ["--coff-exports", exe]);
    const exported = blocks(text, "Export")
      .map(b => field(b, "Name"))
      .filter((s): s is string => s !== undefined && s.length > 0);
    const exact = new Set(expect.exports.exact);
    const pat = globToRegExp(expect.exports.patterns);
    const bad = exported.filter(s => !exact.has(s) && !pat.test(s));
    report(
      "exports",
      `${exported.length} exported symbols`,
      bad.map(s => `+ ${s} (not in the export list)`),
    );
  }

  // 2 + 3. imports: DLL set, forbidden symbols
  {
    const text = run(readobj, ["--coff-imports", exe]);
    const imports = [...blocks(text, "Import"), ...blocks(text, "DelayImport")];
    const dlls = [...new Set(imports.map(b => field(b, "Name")!).filter(Boolean))];
    const violations = setDifference(dlls, expect.neededLibs.names, expect.neededLibs.exact, s => s.toLowerCase());
    report(
      "dynamic libraries",
      `${dlls.length} DLLs (${imports.length - blocks(text, "Import").length} delay-loaded)`,
      violations,
    );
    const syms = [...text.matchAll(/^\s+Symbol: (\S+) \(\d+\)/gm)].map(m => m[1]!);
    const pat = globToRegExp(expect.forbiddenImports);
    const bad = syms.filter(s => pat.test(s));
    report(
      "imports",
      `${syms.length} imported symbols`,
      bad.map(s => `+ ${s} (forbidden import)`),
    );
  }

  // 5. hardening + subsystem/OS version
  if (expect.pe !== undefined) {
    const hdr = run(readobj, ["--file-headers", exe]);
    const violations: string[] = [];
    const chars = flagNames(hdr, "Characteristics")
      .filter(n => n.startsWith("IMAGE_DLL_CHARACTERISTICS_"))
      .map(n => n.replace("IMAGE_DLL_CHARACTERISTICS_", ""));
    violations.push(...setDifference(chars, expect.pe.dllCharacteristics));
    const subsystem = field(hdr, "Subsystem")?.replace(/ \(.*$/, "");
    if (subsystem !== expect.pe.subsystem) violations.push(`subsystem ${subsystem}, expected ${expect.pe.subsystem}`);
    const ver = `${field(hdr, "MajorSubsystemVersion")}.${field(hdr, "MinorSubsystemVersion")}`;
    if (expect.minOSVersion !== undefined && ver !== expect.minOSVersion)
      violations.push(`subsystem version ${ver}, expected ${expect.minOSVersion}`);
    report("hardening", `${chars.join(" ")}; subsystem ${ver}`, violations);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// duplicates: strong external definitions across the link inputs
// ───────────────────────────────────────────────────────────────────────────

/** Windows' command line tops out at 32K characters; keep each nm invocation well inside it. */
const NM_ARGV_BUDGET = 16_000;

function verifyDuplicates(nm: string, rspfile: string, reportPath: string): number {
  const inputs = readFileSync(rspfile, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
  assert(inputs.length > 0, `duplicates: ${rspfile} lists no inputs`);
  // symbol → [ [object, type, size] ]
  const strong = new Map<string, string[]>();
  const weakSizes = new Map<string, Map<string, string>>();
  let scanned = 0;
  for (let start = 0; start < inputs.length; ) {
    let end = start;
    let length = 0;
    do {
      length += inputs[end]!.length + 1;
      end++;
    } while (end < inputs.length && length + inputs[end]!.length < NM_ARGV_BUDGET);
    // -A: prefix each line with the object (archive:member for archives).
    // -S: print size. --extern-only --defined-only: what can collide.
    const r = spawnSync(
      nm,
      ["-A", "-S", "--extern-only", "--defined-only", "--no-demangle", ...inputs.slice(start, end)],
      {
        encoding: "utf8",
        maxBuffer: 1 << 30,
      },
    );
    if (r.error) throw new BuildError(`duplicates: failed to run ${nm}`, { cause: r.error });
    for (const line of r.stdout.split("\n")) {
      // <obj>: <value> [<size>] <type> <name>   (size absent for some formats)
      // Value and size are hex, or dashes for an LTO bitcode object.
      const m = line.match(/^(.*): +[-0-9a-fA-F]* *([-0-9a-fA-F]*) +([A-Za-z]) (\S+)\s*$/);
      if (!m) continue;
      const [, obj, size, type, name] = m as unknown as [string, string, string, string, string];
      scanned++;
      if (type === "W" || type === "V") {
        let sizes = weakSizes.get(name);
        if (sizes === undefined) weakSizes.set(name, (sizes = new Map()));
        if (size !== "" && !sizes.has(size)) sizes.set(size, obj);
      } else if (/[TDBRSG]/.test(type) && type !== "C") {
        // LTO bitcode objects report every definition; COMMON (C) merges by design.
        const objs = strong.get(name);
        if (objs === undefined) strong.set(name, [obj]);
        else objs.push(obj);
      }
    }
    start = end;
  }
  const dups = [...strong].filter(([, objs]) => objs.length > 1);
  const odr = [...weakSizes].filter(([, sizes]) => sizes.size > 1);
  const lines: string[] = [];
  lines.push(`# strong external symbols defined in more than one link input (${dups.length})`);
  for (const [name, objs] of dups) lines.push(name, ...objs.map(o => `    ${o}`));
  lines.push("", `# weak definitions whose size differs between objects (${odr.length}) — informational`);
  for (const [name, sizes] of odr) lines.push(name, ...[...sizes].map(([sz, o]) => `    size 0x${sz} in ${o}`));
  writeFileSync(reportPath, lines.join("\n") + "\n");
  console.log(
    `duplicate symbols: ${scanned} definitions across ${inputs.length} inputs; ${dups.length} duplicated, ${odr.length} weak with differing sizes (${reportPath})`,
  );
  for (const [name, objs] of dups.slice(0, 50)) console.log(`  ${name}\n${objs.map(o => `      ${o}`).join("\n")}`);
  if (dups.length > 50) console.log(`  … ${dups.length - 50} more in ${reportPath}`);
  return dups.length > 0 ? 1 : 0;
}

// ───────────────────────────────────────────────────────────────────────────

function main(argv: string[]): number {
  const [mode, ...args] = argv;
  if (mode === "binary") {
    const [specPath] = args;
    assert(specPath !== undefined, "binary: missing <spec.json>");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as VerifySpec;
    if (spec.expect.format === "elf") verifyElf(spec);
    else if (spec.expect.format === "macho") verifyMachO(spec);
    else verifyPE(spec);
    let failed = 0;
    for (const r of results) {
      console.log(
        `${spec.name} ${r.name}: ${r.summary}${r.violations.length ? ` — ${r.violations.length} violation(s)` : ""}`,
      );
      for (const v of r.violations) console.log(`    ${v}`);
      if (r.violations.length > 0) failed++;
    }
    if (failed > 0)
      console.log(`${spec.name}: ${failed} check(s) failed; expectations live in scripts/build/binary-expectations.ts`);
    return failed > 0 ? 1 : 0;
  }
  if (mode === "duplicates") {
    const [nm, rspfile, reportPath] = args;
    assert(
      nm !== undefined && rspfile !== undefined && reportPath !== undefined,
      "duplicates: missing <nm> <rspfile> <report>",
    );
    return verifyDuplicates(nm, rspfile, reportPath);
  }
  console.error("usage: verify-binary.ts binary <spec.json> | duplicates <nm> <rspfile> <report>");
  return 2;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof BuildError ? err.format() : err);
    process.exit(1);
  }
}
