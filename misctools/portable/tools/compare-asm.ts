// Compares the machine code of the normal builds of two commits, function by function.
//
//   bun compare-asm.ts <before.s> <after.s> [--show <part of a function name>]
//       two files that `rustc --emit=asm` wrote for the same crate
//
//   bun compare-asm.ts target --target <triple> --before <commit> --after <commit> --work <directory>
//                             [--build before|after|both|none] [--crates <name>,<name>] [--jobs 8]
//       a whole target: every crate of the workspace that differs between the two commits
//
// `target` does, for each of the two commits that `--build` names (both, when it is left out):
//   1. `git archive` of the commit into <work>/tree. Both commits are built in that one directory, one after
//      the other, so that the paths in the code and the hashes in the names are the same.
//   2. the generated sources of that tree, for the OS of the triple (`scripts/build.ts --mode=codegen`)
//   3. `cargo build --release` of the crates for the triple with the code generation flags of bun's release
//      build (scripts/build/rust.ts) and `--emit=asm`, into a target directory of its own, at most --jobs jobs
//      on as many CPUs
//   4. per crate, a digest of every function: <work>/<triple>/<before|after>/<crate>.json
// then it compares the digests and writes <work>/<triple>/report.json. A commit that was built before is not
// built again (stamp.json in its directory). `--build none` compares what is there.
//
// The crates are the packages of the workspace whose directory holds a file that differs between the two
// commits, or the ones `--crates` names. A crate that only one of the commits has is reported and not compared.
//
// A function is the lines between its label and the next one. Before two functions are compared, what differs
// between any two builds of the same source is made equal: the hash of a crate and the number of an `impl`
// block in a mangled name, the numbers of local labels, debug and CFI directives. Of a function that is not
// the same the report says whether it is the same instructions in another order. A label in a section that
// is not code is a constant or a variable with a name: they are compared the same way and counted apart.
import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type Digest = { lines: number; text: string; sorted: string; code: boolean };
type Difference = { name: string; lines_before: number; lines_after: number; same_instructions_in_another_order: boolean };

// In a mangled name: the hash of a crate, and the number of an `impl` block among the ones of its module,
// which moves when a block is added in front of it.
const mangled = (text: string) =>
  text
    .replace(/Cs[0-9A-Za-z]+_(\d)/g, "Cs_$1")
    .replace(/17h[0-9a-f]{16}E/g, "17hE")
    .replace(/(_RNv[MX])s[0-9A-Za-z]*_/g, "$1s_");

const ignored = /^\s*\.(type|size|globl|hidden|weak|section|text|p2align|file|loc|cfi_|ident|addrsig|cv_|local|comm|data|bss|def|scl|endef|seh_)/;
const startsSection = /^\s*\.(section|text|data|bss)\b\s*([^,\s]*)/;
const localLabel = /\.L[A-Za-z_0-9$.]+|anon\.[0-9a-f]{32}\.\d+|__unnamed_\d+/g;

/** The lines of a file of any size, one at a time. */
function* linesOf(path: string): Generator<string> {
  const file = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 24);
    let rest = "";
    for (;;) {
      const read = readSync(file, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const text = rest + buffer.toString("latin1", 0, read);
      let start = 0;
      for (;;) {
        const end = text.indexOf("\n", start);
        if (end < 0) break;
        yield text.slice(start, end);
        start = end + 1;
      }
      rest = text.slice(start);
    }
    if (rest.length > 0) yield rest;
  } finally {
    closeSync(file);
  }
}

/** name -> the normalised lines of every function (and named constant) of the file. */
function functions(path: string, keep?: (name: string) => boolean) {
  const out = new Map<string, { code: boolean; lines: string[] }>();
  let current: string[] | undefined;
  let inCode = false;
  for (const raw of linesOf(path)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    const label = /^([A-Za-z_$][A-Za-z_0-9$.]*):$/.exec(line);
    // A constant without a name is `anon.<hash of the crate>.<number>` in an object file for Windows.
    if (label && !label[1].startsWith(".L") && !label[1].startsWith("anon.")) {
      const name = mangled(label[1]);
      if (keep !== undefined && !keep(name)) {
        current = undefined;
        continue;
      }
      current = [];
      out.set(name, { code: inCode, lines: current });
      continue;
    }
    if (ignored.test(line)) {
      const section = startsSection.exec(line);
      if (section) {
        current = undefined;
        inCode = section[1] === "text" || section[2].startsWith(".text") || section[2].startsWith("__TEXT,__text");
      }
      continue;
    }
    if (!current || !line.trim()) continue;
    current.push(mangled(line.trim()));
  }
  // Local labels are numbered over the whole file: inside a function they are named by their order.
  for (const entry of out.values()) {
    const names = new Map<string, string>();
    entry.lines = entry.lines.map(line =>
      line.replace(localLabel, label => {
        if (!names.has(label)) names.set(label, `.L${names.size}`);
        return names.get(label)!;
      }),
    );
  }
  return out;
}

// Labels are named by their order, so they are left out when only the instructions are counted.
const instructions = (lines: string[]) =>
  lines
    .filter(line => !/^\.L\d+:$/.test(line))
    .map(line => line.replace(/\.L\d+/g, ".L"))
    .sort()
    .join("\n");

const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);

function digests(path: string): Record<string, Digest> {
  const out: Record<string, Digest> = {};
  for (const [name, { code, lines }] of functions(path))
    out[name] = { lines: lines.length, text: hash(lines.join("\n")), sorted: hash(instructions(lines)), code };
  return out;
}

function compareDigests(before: Record<string, Digest>, after: Record<string, Digest>) {
  const result = {
    functions_in_both: 0,
    same: 0,
    different: [] as Difference[],
    only_before: [] as string[],
    only_after: [] as string[],
    constants_in_both: 0,
    constants_same: 0,
    constants_different: [] as Difference[],
  };
  for (const [name, a] of Object.entries(before)) {
    const b = after[name];
    if (b === undefined) {
      if (a.code) result.only_before.push(name);
      continue;
    }
    const difference = { name, lines_before: a.lines, lines_after: b.lines, same_instructions_in_another_order: a.sorted === b.sorted };
    if (a.code) {
      result.functions_in_both++;
      if (a.text === b.text) result.same++;
      else result.different.push(difference);
    } else {
      result.constants_in_both++;
      if (a.text === b.text) result.constants_same++;
      else result.constants_different.push(difference);
    }
  }
  for (const [name, b] of Object.entries(after)) if (!(name in before) && b.code) result.only_after.push(name);
  return result;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function run(argv: string[], options: { cwd?: string; env?: Record<string, string | undefined>; log?: string } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
  if (options.log !== undefined) writeFileSync(options.log, Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  if (result.status !== 0) {
    const tail = (result.stderr?.toString() ?? "").slice(-4000);
    throw new Error(`${argv.slice(0, 6).join(" ")} ...: exit ${result.status ?? result.signal}${options.log ? `, log ${options.log}` : ""}\n${tail}`);
  }
  return result.stdout;
}

/** The last `count` CPUs this process may run on, as taskset takes them. */
function allowedCpus(count: number): string {
  const list = /^Cpus_allowed_list:\s*(\S+)/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1] ?? `0-${count - 1}`;
  const cpus: number[] = [];
  for (const part of list.split(",")) {
    const [first, last] = part.split("-").map(Number);
    for (let cpu = first; cpu <= (last ?? first); cpu++) cpus.push(cpu);
  }
  return cpus.slice(-count).join(",");
}

/** The code generation flags of bun's release build without link-time optimisation (scripts/build/rust.ts). */
function rustflags(triple: string, tree: string): string[] {
  const linux = triple.includes("-linux-");
  const x64 = triple.startsWith("x86_64");
  return [
    ...(linux || triple.includes("freebsd") ? ["-Crelocation-model=static"] : []),
    "--check-cfg=cfg(bun_portable)",
    "-Cforce-frame-pointers=yes",
    "-Cllvm-args=-addrsig",
    "-Zshare-generics=y",
    ...(x64 ? ["-Ctarget-cpu=haswell"] : []),
    "--check-cfg=cfg(bun_asan)",
    "--check-cfg=cfg(bun_debug)",
    "--check-cfg=cfg(bun_codegen_embed)",
    "--cfg=bun_codegen_embed",
    "--check-cfg=cfg(socket_fault_injection)",
    "-Zlocation-detail=none",
    `--remap-path-prefix=${tree}=.`,
    "--emit=asm",
  ];
}

function osOf(triple: string): string {
  if (triple.includes("windows")) return "windows";
  if (triple.includes("apple")) return "darwin";
  if (triple.includes("freebsd")) return "freebsd";
  return "linux";
}

type Package = { name: string; directory: string; library: string };

/** The packages of the workspace of a commit that are libraries of the target (no procedural macros). */
function packagesAt(repository: string, commit: string): Package[] {
  const show = (path: string) => spawnSync("git", ["show", `${commit}:${path}`], { cwd: repository, maxBuffer: 1 << 26 });
  const root = Bun.TOML.parse(run(["git", "show", `${commit}:Cargo.toml`], { cwd: repository }).toString()) as { workspace: { members: string[] } };
  const packages: Package[] = [];
  for (const directory of root.workspace.members) {
    const manifest = show(`${directory}/Cargo.toml`);
    if (manifest.status !== 0) continue;
    const toml = Bun.TOML.parse(manifest.stdout.toString()) as { package?: { name?: string }; lib?: { name?: string; "proc-macro"?: boolean; path?: string } };
    if (toml.package?.name === undefined || toml.lib?.["proc-macro"] === true) continue;
    const hasLibrary = toml.lib !== undefined || show(`${directory}/src/lib.rs`).status === 0;
    if (!hasLibrary) continue;
    packages.push({ name: toml.package.name, directory, library: toml.lib?.name ?? toml.package.name.replaceAll("-", "_") });
  }
  return packages;
}

if (process.argv[2] === "target") {
  const args = process.argv.slice(3);
  const triple = option(args, "--target");
  const work = option(args, "--work");
  const commits = { before: option(args, "--before"), after: option(args, "--after") };
  const build = option(args, "--build") ?? "both";
  const jobs = Number(option(args, "--jobs") ?? 8);
  const named = option(args, "--crates")?.split(",");
  if (!triple || !work || !commits.before || !commits.after || !["before", "after", "both", "none"].includes(build))
    throw new Error("usage: bun compare-asm.ts target --target <triple> --before <commit> --after <commit> --work <directory> [--build before|after|both|none] [--crates a,b] [--jobs 8]");
  const repository = resolve(import.meta.dir, "../../..");
  const workDirectory = resolve(work);
  const tree = join(workDirectory, "tree");
  const revision = (commit: string) => run(["git", "rev-parse", `${commit}^{commit}`], { cwd: repository }).toString().trim();
  const revisions = { before: revision(commits.before), after: revision(commits.after) };
  const changedFiles = run(["git", "diff", "--name-only", revisions.before, revisions.after], { cwd: repository }).toString().split("\n").filter(Boolean);

  for (const label of ["before", "after"] as const) {
    if (build !== "both" && build !== label) continue;
    const out = join(workDirectory, triple, label);
    const stampPath = join(out, "stamp.json");
    const flags = rustflags(triple, tree);
    const inputs = { commit: revisions[label], rustflags: flags };
    const packages = packagesAt(repository, revisions[label]);
    const wanted = packages.filter(p => (named ? named.includes(p.name) : changedFiles.some(file => file.startsWith(p.directory + "/"))));
    let built: Record<string, { file: string; symbols: number }> = {};
    if (existsSync(stampPath)) {
      const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
      if (JSON.stringify(stamp.inputs) === JSON.stringify(inputs)) built = stamp.crates;
      else rmSync(out, { recursive: true, force: true });
    }
    const crates = wanted.filter(p => !(p.name in built));
    if (crates.length === 0) {
      console.log(`${label} (${revisions[label].slice(0, 10)}) for ${triple}: built before, kept`);
      continue;
    }
    mkdirSync(join(out, "logs"), { recursive: true });
    console.log(`${label} (${revisions[label].slice(0, 10)}) for ${triple}: export`);
    rmSync(tree, { recursive: true, force: true });
    mkdirSync(tree, { recursive: true });
    const archive = join(workDirectory, "tree.tar");
    run(["git", "archive", "-o", archive, revisions[label]], { cwd: repository });
    run(["tar", "-x", "-f", archive, "-C", tree]);
    rmSync(archive);
    // The two path dependencies outside the workspace: cargo reads their manifests to load the workspace.
    for (const dependency of ["lolhtml", "rust-argon2"]) {
      const from = [join(repository, "vendor", dependency), join(workDirectory, "vendor", dependency)].find(path => existsSync(path));
      if (from === undefined) throw new Error(`vendor/${dependency} is neither in ${repository} nor in ${workDirectory}: a build of the repository fetches it`);
      cpSync(from, join(tree, "vendor", dependency), { recursive: true });
    }

    console.log(`${label}: generated sources`);
    const codegen = join(tree, "build", "asm-codegen");
    run(["bun", "scripts/build.ts", "--mode=codegen", "--profile=release", `--os=${osOf(triple)}`, `--arch=${triple.startsWith("x86_64") ? "x64" : "arm64"}`, `--build-dir=${codegen}`, `-j${jobs}`], {
      cwd: tree,
      env: { ...process.env, GIT_SHA: revisions.before },
      log: join(out, "logs", "codegen.log"),
    });

    console.log(`${label}: cargo build of ${crates.length} crates`);
    const target = join(out, "target");
    const started = Date.now();
    run(
      [
        "taskset",
        "-c",
        allowedCpus(jobs),
        "cargo",
        "build",
        "--release",
        "--locked",
        `-j${jobs}`,
        "--target",
        triple,
        // As bun's build does: the standard library from its source, with the same flags.
        "-Zbuild-std=core,alloc,std,proc_macro,panic_abort",
        "-Zbuild-std-features=panic-unwind,default",
        ...crates.flatMap(p => ["-p", p.name]),
      ],
      {
        cwd: tree,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: target,
          BUN_CODEGEN_DIR: join(codegen, "codegen"),
          CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f"),
          CARGO_TERM_COLOR: "never",
          CARGO_PROFILE_RELEASE_DEBUG: "false",
          GIT_SHA: revisions.before,
        },
        log: join(out, "logs", `cargo-${Object.keys(built).length}.log`),
      },
    );
    const seconds = Math.round((Date.now() - started) / 1000);

    // Where cargo puts what rustc writes depends on its version: the files are looked for by their names.
    const written = join(target, triple, "release");
    const assembly = (readdirSync(written, { recursive: true }) as string[]).filter(file => file.endsWith(".s"));
    for (const p of crates) {
      const files = assembly.filter(file => basename(file).slice(0, basename(file).lastIndexOf("-")) === p.library);
      const [only] = files;
      if (files.length !== 1 || only === undefined) throw new Error(`${p.name}: ${files.length} files of assembly below ${written}`);
      const digest = digests(join(written, only));
      writeFileSync(join(out, `${p.name}.json`), JSON.stringify(digest));
      built[p.name] = { file: join(written, only), symbols: Object.keys(digest).length };
    }
    writeFileSync(stampPath, JSON.stringify({ inputs, seconds, crates: built }, null, 1) + "\n");
    console.log(`${label}: ${crates.length} crates in ${seconds} s`);
  }
  if (build === "before" || build === "after") process.exit(0);

  const sides = { before: join(workDirectory, triple, "before"), after: join(workDirectory, triple, "after") };
  for (const side of Object.values(sides)) if (!existsSync(join(side, "stamp.json"))) throw new Error(`${side} is not built: nothing to compare`);
  const stamps = { before: JSON.parse(readFileSync(join(sides.before, "stamp.json"), "utf8")), after: JSON.parse(readFileSync(join(sides.after, "stamp.json"), "utf8")) };
  for (const label of ["before", "after"] as const)
    if (stamps[label].inputs.commit !== revisions[label]) throw new Error(`${sides[label]} is a build of ${stamps[label].inputs.commit}, not of ${revisions[label]}`);
  const touched = new Set(
    [...packagesAt(repository, revisions.before), ...packagesAt(repository, revisions.after)]
      .filter(p => (named ? named.includes(p.name) : changedFiles.some(file => file.startsWith(p.directory + "/"))))
      .map(p => p.name),
  );
  const report = {
    target: triple,
    before: revisions.before,
    after: revisions.after,
    rustflags: stamps.after.inputs.rustflags,
    crates: [] as unknown[],
    crates_not_compared: [] as { crate: string; why: string }[],
    functions_compared: 0,
    functions_same: 0,
    functions_different: 0,
    constants_compared: 0,
    constants_different: 0,
  };
  for (const name of [...touched].sort()) {
    const inBefore = name in stamps.before.crates;
    const inAfter = name in stamps.after.crates;
    if (!inBefore || !inAfter) {
      report.crates_not_compared.push({ crate: name, why: inBefore ? "not built for the commit after" : inAfter ? "not built for the commit before" : "built for neither commit" });
      continue;
    }
    const result = compareDigests(JSON.parse(readFileSync(join(sides.before, `${name}.json`), "utf8")), JSON.parse(readFileSync(join(sides.after, `${name}.json`), "utf8")));
    report.crates.push({ crate: name, ...result });
    report.functions_compared += result.functions_in_both;
    report.functions_same += result.same;
    report.functions_different += result.different.length;
    report.constants_compared += result.constants_in_both;
    report.constants_different += result.constants_different.length;
    console.log(
      `${name.padEnd(28)} functions ${result.functions_in_both}, same ${result.same}, different ${result.different.length}, only before ${result.only_before.length}, only after ${result.only_after.length}; constants ${result.constants_in_both}, different ${result.constants_different.length}`,
    );
    for (const d of result.different) console.log(`   differs${d.same_instructions_in_another_order ? " (same instructions, another order)" : ""}: ${d.name} ${d.lines_before} -> ${d.lines_after}`);
  }
  for (const c of report.crates_not_compared) console.log(`${c.crate.padEnd(28)} NOT COMPARED: ${c.why}`);
  const reportPath = join(workDirectory, triple, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
  console.log(`${triple}: ${report.functions_compared} functions compared, ${report.functions_different} different, ${report.crates.length} crates. ${reportPath}`);
  process.exit(0);
}

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("usage: bun compare-asm.ts <before.s> <after.s> [--show name]   or   bun compare-asm.ts target ...");
const show = rest[0] === "--show" ? rest[1] : undefined;

if (show) {
  const before = functions(beforePath, name => name.includes(show));
  const after = functions(afterPath, name => name.includes(show));
  for (const [name, { lines: a }] of before) {
    const b = after.get(name)?.lines ?? [];
    console.log(`== ${name}: ${a.length} lines before, ${b.length} after, ${a.join("\n") === b.join("\n") ? "the same" : "DIFFERENT"}`);
    if (a.join("\n") !== b.join("\n")) for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`   ${i}: ${a[i] ?? ""}   |   ${b[i] ?? ""}`);
  }
}
const result = compareDigests(digests(beforePath), digests(afterPath));
console.log(JSON.stringify(result, null, 1));
