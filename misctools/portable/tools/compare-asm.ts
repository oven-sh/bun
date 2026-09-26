// Compares what a build that is not the portable image compiles, in this tree and in a tree of the
// commit the work started from: every crate this tree changed, for one target.
//
//   bun compare-asm.ts --base <tree> --target <triple> [options]
//       --mode asm          (default) release machine code and data, `rustc --emit=asm`
//       --mode expanded     the source after `cfg` and macro expansion, `rustc -Zunpretty=expanded`,
//                           with debug assertions and without. Needs no code generation, so it runs
//                           for every target a `cargo check` runs for.
//       --mode all          both, one after the other. The machine code of a crate does not have
//                           its generic and inline functions, which are compiled where they are
//                           used: the expanded source has them, and so has the machine code of
//                           the crates that use them (--dependents).
//       --crates a,b        instead of the crates whose files differ from the base
//       --dependents        also the crates of the workspace that depend on them: what they inline
//                           and instantiate from the changed crates is compiled there
//       --skip a,b          crates to leave out
//       --work <dir>        cargo's directories and the results (default /tmp/portable/n2/compare)
//       --codegen <dir>     BUN_CODEGEN_DIR, the same for both trees
//       --jobs <n>          (default 8)
//       --show <text>       print the lines that differ of every symbol whose name contains the text
//   bun compare-asm.ts <before.s> <after.s> [--show <text>]
//
// Exit code 0: nothing differs. 1: something does. 2: a build failed.
//
// What is compared in `asm` mode. A symbol is the lines from its label to the next label that is not
// local, with the section it is in and the directives in front of its label (binding, alignment). A
// constant without a name is compared where it is used: a reference to it is replaced by a hash of its
// content. The order of the symbols in the file is compared as well. What two builds of the same source
// in two directories do not share is made equal first: the hash of a crate in a mangled name, and the
// numbers of local labels (inside a symbol they are named by their order). The flags are the ones of
// bun's release build (scripts/build/rust.ts) without link-time optimisation, which leaves no machine
// code in a crate, and without debug information, whose line numbers move with every edit.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

type Format = "elf" | "coff" | "macho";

interface Block {
  /** The label as it is written. */
  label: string;
  name: string;
  local: boolean;
  index: number;
  lines: string[];
  /** Local labels defined inside of a named block, in the order of their definition. */
  inner: string[];
}

interface Parsed {
  named: Map<string, Block>;
  order: string[];
  anonymous: Map<string, Block>;
  /** Local label defined inside of a named block: the block and the label's number in it. */
  innerOwner: Map<string, { block: Block; at: number }>;
  addressSignificant: string[];
}

/** The hash of a crate in a mangled name, which depends on the directory of the workspace. */
function withoutCrateHashes(text: string) {
  return text
    .replace(/Cs[0-9A-Za-z]+_(\d)/g, "Cs_$1")
    .replace(/17h[0-9a-f]{16}E/g, "17hE")
    .replace(/anon\.[0-9a-f]{32}\./g, "anon.")
    .replace(/\.[0-9a-f]{16}-cgu\./g, ".-cgu.");
}

function formatOf(text: string, target?: string): Format {
  if (target?.includes("windows")) return "coff";
  if (target?.includes("apple")) return "macho";
  if (target) return "elf";
  if (/^\s*\.section\s+__(TEXT|DATA)/m.test(text) || /^\s*\.subsections_via_symbols/m.test(text)) return "macho";
  if (/^\s*\.def\s/m.test(text)) return "coff";
  return "elf";
}

function isLocalLabel(label: string, format: Format) {
  if (format === "macho") return /^(L|l_|ltmp|lCPI|l\.)/.test(label);
  return label.startsWith(".L") || /^anon\.[0-9a-f]+\.\d+$/.test(label) || /^__unnamed_\d+$/.test(label);
}

const localReference = {
  elf: /\.L[A-Za-z_0-9$.]+/g,
  coff: /\.L[A-Za-z_0-9$.]+|\banon\.[0-9a-f]{32}\.\d+|\b__unnamed_\d+/g,
  macho: /\b(?:L|l_|ltmp|lCPI)[A-Za-z_0-9$.]+/g,
} as const;

function parse(text: string, format: Format, arm: boolean): Parsed {
  const parsed: Parsed = {
    named: new Map(),
    order: [],
    anonymous: new Map(),
    innerOwner: new Map(),
    addressSignificant: [],
  };
  let section = "";
  let pending: string[] = [];
  let current: Block | undefined;
  let index = 0;
  const comment = format === "macho" ? (arm ? /\s+;.*$/ : /\s+##.*$/) : arm ? /\s+\/\/.*$/ : /\s+#.*$/;
  for (const raw of text.split("\n")) {
    const isText = /^\s*\.(ascii|asciz|string)\s/.test(raw);
    const line = (isText ? raw : raw.replace(comment, "")).trim();
    if (!line || (!isText && (line.startsWith("#") || line.startsWith("//") || line.startsWith(";")))) continue;
    const label = /^"?([^\s":]+)"?:$/.exec(line);
    if (label) {
      const local = isLocalLabel(label[1], format);
      if (local && current && !current.local) {
        parsed.innerOwner.set(label[1], { block: current, at: current.inner.length });
        current.inner.push(label[1]);
        current.lines.push(line);
        continue;
      }
      current = {
        label: label[1],
        name: withoutCrateHashes(label[1]),
        local,
        index: index++,
        lines: [`@section ${section}`, ...pending],
        inner: [],
      };
      pending = [];
      if (local) parsed.anonymous.set(label[1], current);
      else {
        parsed.named.set(current.name, current);
        parsed.order.push(current.name);
      }
      continue;
    }
    // Debug information: the line numbers move with every edit of a file.
    if (/^\.(file|ident|loc|cv_[a-z_]+)\b/.test(line)) continue;
    if (/^\.addrsig_sym\s/.test(line)) {
      parsed.addressSignificant.push(line);
      continue;
    }
    if (
      /^\.(section|text|data|bss|const|rdata|zerofill|tdata|tbss)\b/.test(line) ||
      /^\.subsections_via_symbols/.test(line)
    ) {
      // The number of a section among the ones of the same name moves when a section is added.
      section = line.replace(/,unique,\d+$/, "");
      current = undefined;
      pending = [];
      continue;
    }
    // In front of a label: what the assembler is told about the symbol before it is defined.
    if (
      /^\.(globl|hidden|weak|local|protected|private_extern|weak_definition|weak_def_can_be_hidden|type|p2align|prefalign|balign|def|scl|endef|linkonce)\b/.test(
        line,
      ) &&
      !insideBody(current, line)
    ) {
      pending.push(line);
      continue;
    }
    if (current) current.lines.push(line);
    else pending.push(line);
  }
  return parsed;
}

/** `.p2align` between the instructions of a function belongs to the function, not to the next symbol. */
function insideBody(current: Block | undefined, line: string) {
  return (
    current !== undefined &&
    !current.local &&
    /^\.(p2align|balign)\b/.test(line) &&
    current.lines.length > 0 &&
    !/^(retq?|jmpq?\s|ud2|ret\b|b\s|br\s)/.test(lastInstruction(current))
  );
}

function lastInstruction(block: Block) {
  for (let i = block.lines.length - 1; i >= 0; i--)
    if (!block.lines[i].startsWith(".") && !block.lines[i].startsWith("@")) return block.lines[i];
  return "";
}

function normalized(parsed: Parsed, format: Format) {
  const hashes = new Map<string, string>();
  const stack = new Set<string>();
  const reference = localReference[format];

  function replace(line: string, self: Block): string {
    return withoutCrateHashes(
      line.replace(reference, label => {
        if (label === self.label) return "<self>";
        const inner = parsed.innerOwner.get(label);
        if (inner) return inner.block === self ? `.L${inner.at}` : `<${inner.block.name}#${inner.at}>`;
        const anonymous = parsed.anonymous.get(label);
        if (anonymous) return `<constant ${hashOf(anonymous)}>`;
        return "<local>";
      }),
    );
  }
  function hashOf(block: Block): string {
    const known = hashes.get(block.label);
    if (known) return known;
    if (stack.has(block.label)) return "cycle";
    stack.add(block.label);
    const hash = createHash("sha256")
      .update(block.lines.map(line => replace(line, block)).join("\n"))
      .digest("hex")
      .slice(0, 16);
    stack.delete(block.label);
    hashes.set(block.label, hash);
    return hash;
  }

  const symbols = new Map<string, string[]>();
  for (const [name, block] of parsed.named)
    symbols.set(
      name,
      block.lines.map(line => replace(line, block)),
    );
  const constants = [...parsed.anonymous.values()].map(hashOf).sort();
  const dummy: Block = { label: "", name: "", local: true, index: -1, lines: [], inner: [] };
  const addressSignificant = parsed.addressSignificant.map(line => replace(line, dummy)).sort();
  return { symbols, order: parsed.order, constants, addressSignificant };
}

interface Comparison {
  symbols_in_both: number;
  same: number;
  different: { name: string; lines_before: number; lines_after: number; same_lines_in_another_order: boolean }[];
  only_before: string[];
  only_after: string[];
  order_is_the_same: boolean;
  constants_before: number;
  constants_after: number;
  constants_are_the_same: boolean;
  address_significant_is_the_same: boolean;
}

function compareFiles(
  beforePath: string,
  afterPath: string,
  target: string | undefined,
  show: string | undefined,
): Comparison {
  const beforeText = readFileSync(beforePath, "utf8");
  const afterText = readFileSync(afterPath, "utf8");
  const format = formatOf(beforeText, target);
  const arm = target ? target.startsWith("aarch64") : /^\s*(stp|ldp|adrp)\s/m.test(beforeText);
  const before = normalized(parse(beforeText, format, arm), format);
  const after = normalized(parse(afterText, format, arm), format);
  const result: Comparison = {
    symbols_in_both: 0,
    same: 0,
    different: [],
    only_before: [...before.symbols.keys()].filter(name => !after.symbols.has(name)),
    only_after: [...after.symbols.keys()].filter(name => !before.symbols.has(name)),
    order_is_the_same:
      before.order.filter(name => after.symbols.has(name)).join("\n") ===
      after.order.filter(name => before.symbols.has(name)).join("\n"),
    constants_before: before.constants.length,
    constants_after: after.constants.length,
    constants_are_the_same: before.constants.join("\n") === after.constants.join("\n"),
    address_significant_is_the_same: before.addressSignificant.join("\n") === after.addressSignificant.join("\n"),
  };
  const sorted = (lines: string[]) =>
    lines
      .filter(line => !/^\.L\d+:$/.test(line))
      .map(line => line.replace(/\.L\d+/g, ".L"))
      .sort()
      .join("\n");
  for (const [name, lines] of before.symbols) {
    const other = after.symbols.get(name);
    if (!other) continue;
    result.symbols_in_both++;
    const same = lines.join("\n") === other.join("\n");
    if (same) result.same++;
    else
      result.different.push({
        name,
        lines_before: lines.length,
        lines_after: other.length,
        same_lines_in_another_order: sorted(lines) === sorted(other),
      });
    if (show && name.includes(show)) {
      console.log(
        `== ${name}: ${lines.length} lines before, ${other.length} after, ${same ? "the same" : "DIFFERENT"}`,
      );
      if (!same)
        for (let i = 0; i < Math.max(lines.length, other.length); i++)
          if (lines[i] !== other[i]) console.log(`   ${i}: ${lines[i] ?? ""}   |   ${other[i] ?? ""}`);
    }
  }
  return result;
}

function differs(comparison: Comparison) {
  return (
    comparison.different.length > 0 ||
    comparison.only_before.length > 0 ||
    comparison.only_after.length > 0 ||
    !comparison.order_is_the_same ||
    !comparison.constants_are_the_same ||
    !comparison.address_significant_is_the_same
  );
}

// ---- two trees ----

interface Package {
  name: string;
  id: string;
  directory: string;
  kinds: string[];
}

function run(cmd: string[], cwd: string, env: Record<string, string>, log: string) {
  const result = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 1 << 30,
  });
  writeFileSync(log, Buffer.concat([Buffer.from(`+ ${cmd.join(" ")}   (in ${cwd})\n`), result.stderr]));
  return { ok: result.exitCode === 0, stdout: result.stdout };
}

function metadata(tree: string, target: string, withDependencies: boolean) {
  const args = ["cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", target];
  if (!withDependencies) args.push("--no-deps");
  const result = Bun.spawnSync(args, { cwd: tree, stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 30 });
  if (result.exitCode !== 0) throw new Error(`cargo metadata in ${tree}: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString()) as {
    packages: { name: string; id: string; manifest_path: string; targets: { kind: string[] }[] }[];
    workspace_members: string[];
    resolve?: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
  };
}

function packagesOf(tree: string, target: string): Package[] {
  const data = metadata(tree, target, false);
  return data.packages.map(p => ({
    name: p.name,
    id: p.id,
    directory: dirname(p.manifest_path),
    kinds: p.targets.flatMap(t => t.kind),
  }));
}

function git(tree: string, args: string[]) {
  const result = Bun.spawnSync(["git", "-C", tree, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** bun's release build for the target (scripts/build/rust.ts), without the flags of link-time optimisation. */
function releaseFlags(target: string) {
  const flags: string[] = [];
  const linux = target.includes("linux") && !target.includes("android");
  if (linux || target.includes("freebsd")) flags.push("-Crelocation-model=static");
  flags.push(
    "--check-cfg=cfg(bun_portable)",
    "-Cforce-frame-pointers=yes",
    "-Cllvm-args=-addrsig",
    "-Zshare-generics=y",
  );
  if (target.startsWith("x86_64")) flags.push("-Ctarget-cpu=nehalem");
  else if (target.includes("apple")) flags.push("-Ctarget-cpu=apple-m1");
  else if (target.includes("windows")) flags.push("-Ctarget-cpu=generic", "-Ctarget-feature=+crc");
  else
    flags.push(
      "-Ctarget-cpu=generic",
      "-Ctarget-feature=+crc",
      target.includes("android") ? "-Ztune-cpu=cortex-a78" : "-Ztune-cpu=ampere1",
    );
  flags.push(
    "--check-cfg=cfg(bun_asan)",
    "--check-cfg=cfg(bun_debug)",
    "--check-cfg=cfg(bun_codegen_embed)",
    "--cfg=bun_codegen_embed",
  );
  flags.push(
    "--check-cfg=cfg(socket_fault_injection)",
    "-Zlocation-detail=none",
    "-Alinker_messages",
    "--cap-lints=warn",
  );
  return flags;
}

function filesBelow(directory: string, suffix: string, out: string[] = []) {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) filesBelow(path, suffix, out);
    else if (entry.name.endsWith(suffix)) out.push(path);
  }
  return out;
}

/** The newest `<crate>-<hash>.s` of each crate. */
function assemblyOf(targetDirectory: string) {
  const newest = new Map<string, { path: string; time: number }>();
  for (const path of filesBelow(targetDirectory, ".s")) {
    const match = /([^/]+)-[0-9a-f]{16}\.s$/.exec(path);
    if (!match) continue;
    const time = statSync(path).mtimeMs;
    const known = newest.get(match[1]);
    if (!known || known.time < time) newest.set(match[1], { path, time });
  }
  return newest;
}

/**
 * What `rustc -Zunpretty=expanded` prints, as the tokens the compiler goes on with: no comments, and
 * a layout that depends on the tokens only (a line ends after `;`, `{` and `}`).
 */
function expandedSource(text: string) {
  const tokens: string[] = [];
  let i = 0;
  const n = text.length;
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
    } else if (c === '"' || ((c === "b" || c === "c") && text[i + 1] === '"')) {
      const from = i;
      i += c === '"' ? 1 : 2;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      tokens.push(text.slice(from, i));
    } else if (
      (c === "r" || ((c === "b" || c === "c") && text[i + 1] === "r")) &&
      /^[bc]?r#*"/.test(text.slice(i, i + 40))
    ) {
      const from = i;
      const hashes = /^[bc]?r(#*)"/.exec(text.slice(i, i + 40))![1];
      const close = '"' + hashes;
      i = text.indexOf(close, text.indexOf('"', i) + 1);
      i = i < 0 ? n : i + close.length;
      tokens.push(text.slice(from, i));
    } else if (c === "'") {
      // A character or a lifetime.
      const character = /^'(\\.[^']*|[^\\'])'/.exec(text.slice(i, i + 16));
      if (character) {
        tokens.push(character[0]);
        i += character[0].length;
      } else {
        const from = i++;
        while (i < n && isWord(text[i])) i++;
        tokens.push(text.slice(from, i));
      }
    } else if (isWord(c)) {
      const from = i;
      while (i < n && isWord(text[i])) i++;
      tokens.push(text.slice(from, i));
    } else {
      tokens.push(c);
      i++;
    }
  }
  // The definition of a macro is gone once the macros are expanded; what it expanded to is compared.
  const kept: string[] = [];
  for (let at = 0; at < tokens.length; at++) {
    if (tokens[at] !== "macro_rules" || tokens[at + 1] !== "!") {
      kept.push(tokens[at]);
      continue;
    }
    // Its attributes, which are in front of it.
    while (kept.length && kept[kept.length - 1] === "]") {
      let depth = 0;
      let start = kept.length - 1;
      for (; start >= 0; start--) {
        if (kept[start] === "]") depth++;
        else if (kept[start] === "[" && --depth === 0) break;
      }
      if (start < 1 || kept[start - 1] !== "#") break;
      kept.length = start - 1;
    }
    at += 3;
    const open = tokens[at];
    const close = open === "{" ? "}" : open === "(" ? ")" : "]";
    let depth = 0;
    for (; at < tokens.length; at++) {
      if (tokens[at] === open) depth++;
      else if (tokens[at] === close && --depth === 0) break;
    }
    if (tokens[at + 1] === ";") at++;
  }
  const lines: string[] = [];
  let line: string[] = [];
  for (const token of kept) {
    line.push(token);
    if (token === ";" || token === "{" || token === "}") {
      lines.push(line.join(" "));
      line = [];
    }
  }
  if (line.length) lines.push(line.join(" "));
  return lines.join("\n");
}

async function compareTrees(options: Record<string, string>) {
  const here = dirname(import.meta.path);
  const branch = resolve(here, "../../..");
  const base = resolve(options.base);
  const target = options.target;
  const mode = options.mode ?? "asm";
  const work = resolve(options.work ?? "/tmp/portable/n2/compare");
  const codegen = resolve(options.codegen ?? "/tmp/portable/n2/codegen");
  const jobs = options.jobs ?? "8";
  const skip = new Set((options.skip ?? "").split(",").filter(Boolean));
  if (!target) throw new Error("--target <triple>");
  if (mode !== "asm" && mode !== "expanded") throw new Error("--mode asm or expanded");

  const baseCommit = git(base, ["rev-parse", "HEAD"]);
  const branchPackages = packagesOf(branch, target);
  const basePackages = new Map(packagesOf(base, target).map(p => [p.name, p]));

  let crates: string[];
  const notes: string[] = [];
  if (options.crates) crates = options.crates.split(",");
  else {
    const changed = [
      ...git(branch, ["diff", "--name-only", baseCommit]).split("\n"),
      ...git(branch, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
    ].filter(Boolean);
    const touched = new Set<string>();
    for (const file of changed) {
      const path = join(branch, file);
      const owner = branchPackages
        .filter(p => path.startsWith(p.directory + "/"))
        .sort((a, b) => b.directory.length - a.directory.length)[0];
      if (owner) touched.add(owner.name);
    }
    crates = [...touched].sort();
  }

  const graph = metadata(branch, target, true);
  const idOf = new Map(graph.packages.map(p => [p.id, p.name]));
  const members = new Set(graph.workspace_members.map(id => idOf.get(id)!));
  // Crate -> the crates it is compiled with for this target (normal and build dependencies).
  const dependencies = new Map<string, Set<string>>();
  for (const node of graph.resolve?.nodes ?? []) {
    const name = idOf.get(node.id)!;
    const set = dependencies.get(name) ?? new Set<string>();
    for (const dep of node.deps) if (dep.dep_kinds.some(kind => kind.kind !== "dev")) set.add(idOf.get(dep.pkg)!);
    dependencies.set(name, set);
  }
  const reaches = (from: string, to: Set<string>, seen = new Set<string>()): boolean => {
    if (to.has(from)) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of dependencies.get(from) ?? []) if (reaches(next, to, seen)) return true;
    return false;
  };
  // A crate that is new in this tree must not be part of a build that is not the portable image.
  const inBuild = new Set<string>();
  const roots = [...members].filter(name => basePackages.has(name));
  const collect = (name: string) => {
    if (inBuild.has(name)) return;
    inBuild.add(name);
    for (const next of dependencies.get(name) ?? []) collect(next);
  };
  roots.forEach(collect);
  const added: string[] = [];
  const compared: string[] = [];
  for (const name of crates) {
    if (skip.has(name)) continue;
    if (!basePackages.has(name)) {
      if (inBuild.has(name)) added.push(name);
      else notes.push(`${name}: new in this tree, and no crate of the base depends on it for ${target}`);
      continue;
    }
    if (branchPackages.find(p => p.name === name)?.kinds.includes("proc-macro")) {
      notes.push(`${name}: a proc macro, compiled for the machine that builds`);
      continue;
    }
    compared.push(name);
  }
  const hasLibrary = (name: string) =>
    branchPackages.find(p => p.name === name)?.kinds.some(kind => /lib$/.test(kind)) ?? false;
  if (options.dependents !== undefined) {
    const touched = new Set(compared);
    for (const member of [...members].sort()) {
      if (touched.has(member) || skip.has(member) || !basePackages.has(member)) continue;
      if (branchPackages.find(p => p.name === member)?.kinds.includes("proc-macro")) continue;
      if (!reaches(member, touched)) continue;
      if (hasLibrary(member)) compared.push(member);
      else notes.push(`${member}: a program that is built on request only, no library`);
    }
  }

  mkdirSync(join(work, "logs"), { recursive: true });
  const report: Record<string, unknown> = {
    mode,
    target,
    base: baseCommit,
    branch: git(branch, ["rev-parse", "HEAD"]),
    crates: compared,
    notes,
    added_to_the_build: added,
  };
  let failed = added.length > 0;
  let buildFailed = false;

  if (mode === "asm") {
    const rustflags = [...releaseFlags(target), "-Cdebuginfo=0", "--emit=asm"];
    const directories: Record<string, string> = {};
    for (const [side, tree] of [
      ["base", base],
      ["branch", branch],
    ] as const) {
      const targetDirectory = join(work, `target-asm-${side}`);
      directories[side] = join(targetDirectory, target);
      const log = join(work, "logs", `asm-${side}-${target}.log`);
      const built = run(
        ["cargo", "build", "--release", "--locked", "--target", target, ...compared.flatMap(name => ["-p", name])],
        tree,
        {
          CARGO_TARGET_DIR: targetDirectory,
          CARGO_BUILD_JOBS: jobs,
          BUN_CODEGEN_DIR: codegen,
          CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
        },
        log,
      );
      if (!built.ok) {
        console.error(`the build of ${side} failed: ${log}`);
        console.error(readFileSync(log, "utf8").split("\n").slice(-40).join("\n"));
        buildFailed = true;
      }
    }
    if (!buildFailed) {
      const before = assemblyOf(directories.base);
      const after = assemblyOf(directories.branch);
      const results: Record<string, unknown> = {};
      let symbols = 0;
      let different = 0;
      for (const name of compared) {
        const a = before.get(name),
          b = after.get(name);
        if (!a || !b) {
          results[name] = { error: `no assembly: ${a ? "" : "base "}${b ? "" : "branch"}` };
          failed = true;
          continue;
        }
        const comparison = compareFiles(a.path, b.path, target, options.show);
        symbols += comparison.symbols_in_both;
        different += comparison.different.length + comparison.only_before.length + comparison.only_after.length;
        if (differs(comparison)) failed = true;
        results[name] = { before: a.path, after: b.path, ...comparison };
      }
      report.symbols_compared = symbols;
      report.different = different;
      report.results = results;
    }
  } else {
    const results: Record<string, unknown> = {};
    let different = 0;
    for (const assertions of ["false", "true"]) {
      for (const name of compared) {
        const texts: string[] = [];
        for (const [side, tree] of [
          ["base", base],
          ["branch", branch],
        ] as const) {
          const log = join(work, "logs", `expanded-${side}-${target}-${name}-${assertions}.log`);
          const expanded = run(
            [
              "cargo",
              "rustc",
              "--profile",
              "check",
              "--locked",
              "--lib",
              "--target",
              target,
              "-p",
              name,
              "--",
              "-Zunpretty=expanded",
            ],
            tree,
            {
              CARGO_TARGET_DIR: join(work, `target-expanded-${side}`),
              CARGO_BUILD_JOBS: jobs,
              BUN_CODEGEN_DIR: codegen,
              CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: assertions,
              CARGO_ENCODED_RUSTFLAGS: [...releaseFlags(target)].join("\x1f"),
            },
            log,
          );
          if (!expanded.ok) {
            console.error(`${name} (${side}) does not compile for ${target}: ${log}`);
            console.error(readFileSync(log, "utf8").split("\n").slice(-30).join("\n"));
            buildFailed = true;
            texts.push("");
            continue;
          }
          const text = expandedSource(expanded.stdout.toString());
          const path = join(work, `expanded-${side}-${target}-${name}-${assertions}.rs`);
          writeFileSync(path, text + "\n");
          texts.push(path);
        }
        if (!texts[0] || !texts[1]) continue;
        const same = readFileSync(texts[0], "utf8") === readFileSync(texts[1], "utf8");
        const key = `${name} (debug assertions ${assertions})`;
        const diffPath = join(work, `expanded-${target}-${name}-${assertions}.diff`);
        if (same) {
          results[key] = "the same";
          if (existsSync(diffPath)) rmSync(diffPath);
        } else {
          different++;
          failed = true;
          const diff = Bun.spawnSync(["diff", "-U2", texts[0], texts[1]], { stdout: "pipe" }).stdout.toString();
          writeFileSync(diffPath, diff);
          results[key] = { differs: diffPath, lines_of_the_diff: diff.split("\n").length };
        }
      }
    }
    report.different = different;
    report.results = results;
  }

  const path = join(work, `${mode}-${target}.json`);
  writeFileSync(path, JSON.stringify(report, null, 1) + "\n");
  const summary = {
    ...report,
    results: undefined,
    report: path,
    result: buildFailed ? "a build failed" : failed ? "DIFFERENT" : "the same",
  };
  console.log(JSON.stringify(summary, null, 1));
  if (failed && report.results)
    for (const [name, result] of Object.entries(report.results as Record<string, any>))
      if (result !== "the same" && (result.error || result.differs || differs(result)))
        console.log(
          name,
          JSON.stringify(
            result.differs || result.error
              ? result
              : {
                  different: result.different,
                  only_before: result.only_before,
                  only_after: result.only_after,
                  order_is_the_same: result.order_is_the_same,
                  constants_are_the_same: result.constants_are_the_same,
                  address_significant_is_the_same: result.address_significant_is_the_same,
                },
            null,
            1,
          ),
        );
  process.exit(buildFailed ? 2 : failed ? 1 : 0);
}

const argv = process.argv.slice(2);
const options: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) positional.push(argv[i]);
  else if (argv[i] === "--dependents") options.dependents = "";
  else options[argv[i].slice(2)] = argv[++i] ?? "";
}
if (options.base && options.mode === "all") {
  let worst = 0;
  for (const mode of ["expanded", "asm"]) {
    const forwarded = argv.flatMap((argument, index) => (argument === "--mode" || argv[index - 1] === "--mode" ? [] : [argument]));
    const result = Bun.spawnSync(["bun", import.meta.path, ...forwarded, "--mode", mode], { stdout: "inherit", stderr: "inherit" });
    worst = Math.max(worst, result.exitCode ?? 2);
  }
  process.exit(worst);
} else if (options.base) await compareTrees(options);
else if (positional.length === 2) {
  const comparison = compareFiles(positional[0], positional[1], options.target, options.show);
  console.log(JSON.stringify(comparison, null, 1));
  process.exit(differs(comparison) ? 1 : 0);
} else {
  console.error(
    "usage: bun compare-asm.ts --base <tree> --target <triple> [--mode asm|expanded] [--crates a,b] [--dependents] [--skip a,b] [--work dir] [--show text]",
  );
  console.error("       bun compare-asm.ts <before.s> <after.s> [--show text]");
  process.exit(2);
}
