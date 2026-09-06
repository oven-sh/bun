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
import { type BinaryExpectations, symbolList, versionScriptGlobals } from "./binary-expectations.ts";
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

type CheckName = "exports" | "dynamic libraries" | "imports" | "static initializers" | "hardening" | "debug info";

/**
 * What a violation of each check means for the shipped binary and what the
 * usual fix is — printed under the violations, because the tempting reaction
 * to "unexpected X" is to add X to the expected list, and for most of these
 * that is the one change that should be a deliberate product decision.
 */
const GUIDANCE: Record<CheckName, string[]> = {
  "dynamic libraries": [
    "A new NEEDED/dylib/DLL entry is a new runtime requirement on every machine that runs bun:",
    "the binary will not start where that library (at that soname) is absent, and sonames",
    "change across OS major versions — bun 1.4.0 stopped launching on FreeBSD 15 because it",
    "had picked up libutil.so.9. Likewise a raised GLIBC_/FBSD_ version raises the minimum",
    "OS release bun supports. Default fix: link that code statically or avoid the call;",
    "only extend binary-expectations.ts if shipping the new requirement is the intent.",
  ],
  exports: [
    "An exported symbol is ABI other binaries (native addons) can bind to, and it defeats",
    "dead-stripping and internalization for everything reachable from it. Exports are meant",
    "to come only from the lists in src/ (linker.lds, symbols.txt, symbols.def, NAPI_EXTERN /",
    "BUN_EXPORT in code); a stray one is usually a vendored header's __declspec(dllexport)",
    'or visibility("default"). Fix the declaration rather than extending the list.',
  ],
  imports: [
    "These imports mean a toolchain feature bun builds without has crept into some object",
    "(C++ exceptions / RTTI runtime, emulated TLS, libatomic calls). Find the object that",
    "references the symbol (llvm-nm -A over the link inputs) and fix its compile flags.",
  ],
  "static initializers": [
    "A static initializer runs before main() on every start of every bun process, in",
    "unspecified order relative to the others, and its page is dirtied even if the feature",
    "is never used. bun, JSC and WTF have none by policy: use a function-local static,",
    "WTF::LazyNeverDestroyed / NeverDestroyed, or constinit. The symbol name says which",
    "translation unit added it (_GLOBAL__sub_I_<file>).",
  ],
  hardening: [
    "These bits are process-wide exploit mitigations / layout guarantees (non-executable",
    "stack, no writable+executable mapping, ASLR flags). Losing one is almost always an",
    "unintended side effect of a linker-flag or toolchain change; find that change.",
  ],
  "debug info": [
    "The profile binary is what crash reports and profilers are symbolized against; it",
    "must keep its symbol table and (compressed) debug sections. A missing piece usually",
    "means a strip/objcopy step or a -g flag change applied to the wrong artifact.",
  ],
};

interface CheckResult {
  name: CheckName;
  /** `<count> <noun>` — the one thing printed when the check passes. */
  summary: string;
  violations: string[];
  /** What was found, itemized; printed only alongside violations. */
  details: string[];
  ms: number;
}
const results: CheckResult[] = [];
let checkStarted = performance.now();
function report(name: CheckName, summary: string, violations: string[] = [], details: string[] = []): void {
  const now = performance.now();
  results.push({ name, summary, violations, details, ms: now - checkStarted });
  checkStarted = now;
}
const formatMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

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

/** The export allowlist: the spec's literals plus whatever the referenced files in src/ list right now. */
function expectedExports(expect: BinaryExpectations): { exact: Set<string>; pat: RegExp; dpat: RegExp } {
  const fromScript =
    expect.exports.versionScript !== undefined ? versionScriptGlobals(expect.exports.versionScript) : undefined;
  const fromList = expect.exports.symbolList !== undefined ? symbolList(expect.exports.symbolList) : [];
  return {
    exact: new Set([...expect.exports.exact, ...fromList]),
    pat: globToRegExp([...expect.exports.patterns, ...(fromScript?.patterns ?? [])]),
    dpat: globToRegExp(fromScript?.demangledPatterns ?? []),
  };
}

/** Dynamic-library set vs expectations: `names` (exact or superset per `exact`); extras matching `allowed` are fine. */
function libraryDifference(
  found: string[],
  expect: BinaryExpectations["neededLibs"],
  normalize = (s: string) => s,
): string[] {
  const names = new Set(expect.names.map(normalize));
  const allowed = globToRegExp((expect.allowed ?? []).map(normalize));
  return setDifference(
    found.filter(f => names.has(normalize(f)) || !allowed.test(normalize(f))),
    expect.names,
    expect.exact,
    normalize,
  );
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
    const { exact, pat, dpat } = expectedExports(expect);
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
      `${exported.length - copyRelocated.size} exported symbols`,
      bad.map(s => `+ ${s} (not in the export list)`),
    );
  }

  // 2. needed libs + symbol version ceilings
  {
    const needed = (info.match(/NeededLibraries \[([^\]]*)\]/)?.[1] ?? "")
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const violations = libraryDifference(needed, expect.neededLibs);
    // Only what we *require* (verneed), not the versions we define (verdef).
    const verneed = info.match(/VersionRequirements \[[\s\S]*?\n\]/)?.[0] ?? "";
    const maxSeen = new Map<string, string>();
    for (const m of verneed.matchAll(/Name: ([A-Za-z+]+)_([0-9][0-9.]*)\s*$/gm)) {
      const [, prefix, ver] = m as unknown as [string, string, string];
      const cur = maxSeen.get(prefix);
      if (cur === undefined || !versionLeq(ver, cur)) maxSeen.set(prefix, ver);
    }
    if (expect.maxSymbolVersions !== undefined) {
      // Version nodes without a number are requirements too: GLIBC_ABI_DT_RELR
      // (packed relative relocations, glibc >= 2.36) and GLIBC_PRIVATE would
      // both raise or break the floor while passing a numeric ceiling; bionic
      // names all of its nodes that way (LIBC_N, LIBC_O, …), listed in
      // versionNames.
      const allowedNames = new Set(expect.versionNames ?? []);
      for (const m of verneed.matchAll(/^\s*Name: (\S+)\s*$/gm)) {
        const name = m[1]!;
        if (!/^[A-Za-z+]+_[0-9][0-9.]*$/.test(name) && !allowedNames.has(name))
          violations.push(`${name} required (not an expected version node: raises or breaks the libc floor)`);
      }
      for (const [prefix, ver] of maxSeen) {
        const ceiling = expect.maxSymbolVersions[prefix];
        if (ceiling === undefined) violations.push(`+ ${prefix}_${ver} (no ${prefix} versioned imports expected)`);
        else if (!versionLeq(ver, ceiling))
          violations.push(`${prefix}_${ver} required, ceiling is ${prefix}_${ceiling}`);
      }
    }
    report("dynamic libraries", `${needed.length} shared libraries`, violations, [
      ...needed,
      ...[...maxSeen].map(([p, v]) => `max ${p}_${v}`),
    ]);
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
      `${imported.length} imported symbols`,
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
    report("static initializers", `${names.length} static initializers`, violations, names);
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
    const props = [type, "nx-stack", "no-rwx", ...(relro ? ["relro"] : []), ...(bindNow ? ["bind-now"] : [])];
    report("hardening", `${props.length} hardening properties`, violations, props);
  }

  // 8. debug info / symtab
  if (expect.debugInfo !== undefined) {
    const violations: string[] = [];
    const symtab = section(".symtab") !== undefined;
    // DWARF only: rustc's `.debug_gdb_scripts` (a one-line loader hint in
    // debug builds) is not debug info and is never compressed.
    const debug = sections.filter(b => /^\.debug_(?!gdb_scripts)/.test(field(b, "Name") ?? ""));
    const compressed = debug.length > 0 && debug.every(b => flagNames(b, "Flags").includes("SHF_COMPRESSED"));
    if (symtab !== expect.debugInfo.symtab) violations.push(`.symtab ${symtab ? "present" : "absent"}`);
    if (debug.length > 0 !== expect.debugInfo.debugSections)
      violations.push(`.debug_* ${debug.length > 0 ? "present" : "absent"}`);
    if (expect.debugInfo.debugSections && compressed !== expect.debugInfo.compressed)
      violations.push(
        `.debug_* ${compressed ? "compressed" : "uncompressed"}, expected ${expect.debugInfo.compressed ? "compressed" : "uncompressed"}`,
      );
    report("debug info", `${debug.length} debug sections`, violations, [
      symtab ? "symtab" : "no symtab",
      compressed ? "compressed" : "uncompressed",
    ]);
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
    const { exact, pat } = expectedExports(expect);
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
    const violations = libraryDifference(uniq, expect.neededLibs);
    const minos = priv.match(/^\s+minos ([0-9.]+)/m)?.[1];
    const sameVersion = (a: string | undefined, b: string) => a !== undefined && versionLeq(a, b) && versionLeq(b, a);
    if (expect.minOSVersion !== undefined && !sameVersion(minos, expect.minOSVersion))
      violations.push(`minos ${minos}, expected ${expect.minOSVersion}`);
    report("dynamic libraries", `${uniq.length} shared libraries`, violations, [
      ...uniq.map(s => s.replace(/^.*\//, "")),
      `minos ${minos}`,
    ]);
  }

  // 3. forbidden imports
  {
    const imported = run(nm, ["--undefined-only", "--format=just-symbols", "--no-demangle", exe])
      .split("\n")
      .filter(s => s.length > 0);
    // Mach-O spells every C-level symbol with one more leading underscore.
    const pat = globToRegExp(expect.forbiddenImports.map(p => `_${p}`));
    const bad = imported.filter(s => pat.test(s));
    report(
      "imports",
      `${imported.length} imported symbols`,
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
    const allowed = globToRegExp(expect.staticInitializers.map(p => `_${p}`));
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
    report("static initializers", `${names.length} static initializers`, violations, names);
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
    const props = [...flagLine.trim().split(/\s+/).slice(7), ...seen];
    report("hardening", `${props.length} hardening properties`, violations, props);
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
    const { exact, pat } = expectedExports(expect);
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
    const violations = libraryDifference(dlls, expect.neededLibs, s => s.toLowerCase());
    report("dynamic libraries", `${dlls.length} shared libraries`, violations, [
      ...dlls,
      `${imports.length - blocks(text, "Import").length} delay-loaded`,
    ]);
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
    const props = [...chars, `subsystem ${ver}`];
    report("hardening", `${props.length} hardening properties`, violations, props);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// duplicates: strong external definitions across the link inputs
// ───────────────────────────────────────────────────────────────────────────

/** Windows' command line tops out at 32K characters; keep each nm invocation well inside it. */
const NM_ARGV_BUDGET = 16_000;

/** Run `tool args... <inputs>` over all inputs, chunked to stay under the argv limit. */
function* chunkedRun(tool: string, args: string[], inputs: string[]): Generator<{ stdout: string; stderr: string }> {
  for (let start = 0; start < inputs.length; ) {
    let end = start;
    let length = 0;
    do {
      length += inputs[end]!.length + 1;
      end++;
    } while (end < inputs.length && length + inputs[end]!.length < NM_ARGV_BUDGET);
    const r = spawnSync(tool, [...args, ...inputs.slice(start, end)], { encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.error) throw new BuildError(`duplicates: failed to run ${tool}`, { cause: r.error });
    if (r.signal) throw new BuildError(`duplicates: ${tool} died with ${r.signal}\n${r.stderr}`);
    // A non-zero exit means some input could not be read; the caller turns
    // the stderr lines into per-file diagnostics rather than dropping them.
    yield { stdout: r.stdout, stderr: r.status === 0 ? "" : r.stderr || `${tool} exited ${r.status}` };
    start = end;
  }
}

/** `llvm-nm: error: <file>: <why>` lines → readable one-liners. */
function toolErrors(stderr: string): string[] {
  return stderr
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^\s*$/.test(l))
    .map(l => l.replace(/^.*?(?:error|warning): /, ""));
}

/** True for LLVM bitcode (raw or wrapped), which llvm-objdump -t cannot read; those inputs stay with llvm-nm. */
function isBitcode(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const magic = Buffer.alloc(4);
    readSync(fd, magic, 0, 4, 0);
    return magic.equals(Buffer.from([0x42, 0x43, 0xc0, 0xde])) || magic.readUInt32LE(0) === 0x0b17c0de;
  } finally {
    closeSync(fd);
  }
}

interface Definition {
  obj: string;
  name: string;
  size: string;
  /** Weak, common or COMDAT: the linker folds duplicates by design. */
  foldable: boolean;
}

/**
 * COFF objects: llvm-nm shows a COMDAT definition (every inline function,
 * template instantiation and vftable) exactly like a strong one, so COFF
 * members are read with `llvm-objdump -t` instead, which prints each
 * section's COMDAT selection. Returns the definitions plus the set of
 * objects it covered (nm's lines for those are then ignored). Bitcode
 * members are skipped by objdump and stay with nm.
 */
function coffDefinitions(
  objdump: string,
  allInputs: string[],
  errors: string[],
): { defs: Definition[]; objects: Set<string> } {
  const defs: Definition[] = [];
  const objects = new Set<string>();
  const IMAGE_COMDAT_SELECT_NODUPLICATES = 1;
  // A standalone bitcode .obj makes objdump stop at it ("not a valid object
  // file"), so those go to nm only; inside archives objdump skips them itself.
  const inputs = allInputs.filter(f => !isBitcode(f));
  for (const { stdout: out, stderr } of chunkedRun(objdump, ["-t"], inputs)) {
    errors.push(...toolErrors(stderr));
    // One block per object: `<path>:\tfile format coff-…` or `<archive>(<member>):…`.
    for (const block of out.split(/^(?=\S.*:\tfile format )/m)) {
      const header = block.match(/^(.*?)(?:\(([^()]*)\))?:\tfile format (\S+)/);
      if (!header || !/^coff/i.test(header[3]!)) continue;
      const obj = header[2] !== undefined ? `${header[1]}:${header[2]}` : header[1]!; // nm -A's spelling
      objects.add(obj);
      // Import-library members (`COFF-import-file` stubs, and the descriptor
      // objects an import library names after its DLL — rustc bundles both
      // for raw-dylib links) are import-table glue, not definitions; two
      // crates importing the same DLL legitimately repeat them.
      if (header[3] !== undefined && (/import/i.test(header[3]) || /\.(dll|exe)$/i.test(header[2] ?? ""))) continue;
      const comdat = new Map<number, number>(); // section number → COMDAT selection (0 = not COMDAT)
      const externals: { sec: number; name: string }[] = [];
      const lines = block.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(
          /^\[ *\d+\]\(sec +(-?\d+)\)\(fl 0x[0-9a-f]+\)\(ty +[0-9a-f]+\)\(scl +(\d+)\) \(nx (\d)\) 0x[0-9a-f]+ (.+)$/,
        );
        if (!m) continue;
        const [sec, scl, nx, name] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]!];
        if (scl === 3 && nx === 1) {
          // Section definition symbol; its AUX record carries the selection.
          const aux = lines[i + 1]?.match(/^AUX scnlen .* comdat (\d+)/);
          if (aux) comdat.set(sec, Number(aux[1]));
        } else if (scl === 2 && sec > 0) {
          externals.push({ sec, name }); // IMAGE_SYM_CLASS_EXTERNAL, defined
        }
      }
      for (const { sec, name } of externals) {
        const selection = comdat.get(sec) ?? 0;
        defs.push({ obj, name, size: "", foldable: selection !== 0 && selection !== IMAGE_COMDAT_SELECT_NODUPLICATES });
      }
    }
  }
  return { defs, objects };
}

function verifyDuplicates(nm: string, objdump: string | undefined, rspfile: string, reportPath: string): number {
  // .res (compiled Windows resources) is a link input with no symbols and
  // no object format nm reads; everything else on the line must scan.
  const inputs = readFileSync(rspfile, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.endsWith(".res"));
  assert(inputs.length > 0, `duplicates: ${rspfile} lists no inputs`);
  const defs: Definition[] = [];
  // --coff: the target is Windows. COFF members go through objdump (above);
  // for the LTO bitcode members nm's Darwin form is right except for MS-ABI
  // vftables/vbtables/RTTI descriptors (??_7 ??_8 ??_R): COMDAT by ABI, but
  // with RTTI on clang models the vftable as an external *alias* into that
  // COMDAT, which nm reports as a plain external definition.
  const errors: string[] = []; // inputs a tool could not read — reported, never skipped silently
  const coff = objdump !== undefined ? coffDefinitions(objdump, inputs, errors) : undefined;
  for (const d of coff?.defs ?? []) defs.push(d); // not push(...): more entries than an argument list holds
  const msAbiComdat = (name: string): boolean => coff !== undefined && /^\?\?_[78R]/.test(name);
  // -A: prefix each line with the object (archive:member for archives).
  // -S: print size. --extern-only --defined-only: what can collide.
  // -m: Mach-O and LTO bitcode objects print the Darwin form, which is the
  // only one that says whether a definition is weak ("weak external"); ELF
  // objects ignore it and print the BSD form, whose type letter (W/V/C)
  // carries the same bit.
  for (const { stdout: out, stderr } of chunkedRun(
    nm,
    ["-A", "-S", "-m", "--extern-only", "--defined-only", "--no-demangle"],
    inputs,
  )) {
    errors.push(...toolErrors(stderr).filter(e => !/no symbols$/.test(e)));
    for (const line of out.split("\n")) {
      // Darwin form: `<obj>: <value> (<segment>,<section>) [weak] [private] external [<attrs>] <name>`
      const d = line.match(
        /^(.*): +[-0-9a-fA-F]+ (\([^)]*\)(?: \([^)]*\))*) ((?:weak )?)(?:private )?external (?:\[[^\]]*\] )?(\S+)\s*$/,
      );
      if (d) {
        const name = d[4]!;
        defs.push({
          obj: d[1]!,
          name,
          size: "",
          foldable: d[3] !== "" || d[2]!.startsWith("(common)") || msAbiComdat(name),
        });
        continue;
      }
      // BSD form: `<obj>: <value> [<size>] <type> <name>`; value/size are hex, or dashes for bitcode.
      const b = line.match(/^(.*): +[-0-9a-fA-F]* *([-0-9a-fA-F]*) +([A-Za-z]) (\S+)\s*$/);
      if (!b) continue;
      const [obj, type] = [b[1]!, b[3]!];
      if (coff?.objects.has(obj) || !/[TDBRSGWVC]/.test(type)) continue;
      defs.push({ obj, name: b[4]!, size: b[2]!.replace(/^-+$/, ""), foldable: "WVC".includes(type) });
    }
  }

  const strong = new Map<string, string[]>();
  const weakSizes = new Map<string, Map<string, string>>();
  for (const { obj, name, size, foldable } of defs) {
    if (foldable) {
      let sizes = weakSizes.get(name);
      if (sizes === undefined) weakSizes.set(name, (sizes = new Map()));
      if (size !== "" && !sizes.has(size)) sizes.set(size, obj);
    } else {
      const objs = strong.get(name);
      if (objs === undefined) strong.set(name, [obj]);
      else objs.push(obj);
    }
  }
  const scanned = defs.length;
  const dups = [...strong].filter(([, objs]) => objs.length > 1);
  const odr = [...weakSizes].filter(([, sizes]) => sizes.size > 1);
  const lines: string[] = [];
  lines.push(`# strong external symbols defined in more than one link input (${dups.length})`);
  for (const [name, objs] of dups) lines.push(name, ...objs.map(o => `    ${o}`));
  lines.push("", `# weak definitions whose size differs between objects (${odr.length}) — informational`);
  for (const [name, sizes] of odr) lines.push(name, ...[...sizes].map(([sz, o]) => `    size 0x${sz} in ${o}`));
  writeFileSync(reportPath, lines.join("\n") + "\n");
  if (errors.length > 0) {
    console.log(`${errors.length} link inputs could not be scanned:`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
    if (errors.length > 20) console.log(`  … ${errors.length - 20} more`);
    console.log(
      `  (an "Unknown attribute kind" / "Invalid record" here means the objects hold LLVM bitcode newer than ${nm};\n` +
        `   the build passes rustc's own llvm-nm for that case — rustup component llvm-tools must be installed)`,
    );
    return 1;
  }
  console.log(
    `${dups.length} duplicate strong symbols${dups.length ? ` in ${scanned} definitions across ${inputs.length} inputs` : ""}`,
  );
  for (const [name, objs] of dups.slice(0, 50)) console.log(`  ${name}\n${objs.map(o => `      ${o}`).join("\n")}`);
  if (dups.length > 50) console.log(`  … ${dups.length - 50} more in ${reportPath}`);
  if (dups.length > 0)
    console.log(`  full report (and ${odr.length} weak definitions with differing sizes): ${reportPath}`);
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
        `${r.summary}${r.violations.length ? ` — ${r.name}: ${r.violations.length} violation(s)` : ""} (${formatMs(r.ms)})`,
      );
      if (r.violations.length > 0) {
        failed++;
        if (r.details.length > 0) console.log(`    found: ${r.details.join(", ")}`);
        for (const v of r.violations) console.log(`    ${v}`);
        for (const line of GUIDANCE[r.name]) console.log(`  ${line}`);
      }
    }
    if (failed > 0)
      console.log(
        `${failed} check(s) failed. Expectations: scripts/build/binary-expectations.ts (read the note on each list before extending it).`,
      );
    return failed > 0 ? 1 : 0;
  }
  if (mode === "duplicates") {
    // duplicates <nm> <rspfile> <report> [<objdump, for a Windows target>]
    const [nm, rspfile, reportPath, objdump] = args;
    assert(
      nm !== undefined && rspfile !== undefined && reportPath !== undefined,
      "duplicates: missing <nm> <rspfile> <report>",
    );
    return verifyDuplicates(nm, objdump, rspfile, reportPath);
  }
  console.error("usage: verify-binary.ts binary <spec.json> | duplicates <nm> <rspfile> <report> [objdump]");
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
