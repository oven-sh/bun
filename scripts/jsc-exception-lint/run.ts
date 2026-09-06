#!/usr/bin/env bun
// Driver for scripts/jsc-exception-lint/jsc-exception-lint.cpp.
//
//   bun scripts/jsc-exception-lint/run.ts [options] [file...]
//
// Options:
//   --build-dir <dir>    build dir with compile_commands.json (default build/debug)
//   --jobs <n>           parallel processes (default: cpu count)
//   --json <file>        also write the findings as JSON
//   --webkit             recompute the JavaScriptCore callee summaries
//   --webkit-only        stop after the JavaScriptCore summaries
//   --webkit-rounds <n>  summary passes over JavaScriptCore (default 3). Each pass
//                        resolves one more level of cross-file calls.
//   --no-summaries       skip the whole-project summary passes (faster, more false positives)
//   --reuse-summaries    skip the Bun summary pass and import the one from the previous run
//   --kind <k>[,<k>]     only print these kinds (pending-call, thrown-call, unchecked-exit,
//                        scope-while-pending, maybe-thrown-call). maybe-thrown-call is
//                        hidden unless asked for: it marks a call made after a helper
//                        that may have thrown and returned a failure value the caller
//                        usually tests.
//
// The tool needs the LLVM 21 development package (libclang-cpp, headers). Set
// LLVM_DIR to point at it if it is not under /usr/lib/llvm-21 or `brew
// --prefix llvm`.
//
// Summaries: functions defined in another translation unit cannot be analyzed
// from their call site. Two export passes (JavaScriptCore's translation units
// from the same compile database, then Bun's bindings) record each function's
// effect on the exception state in a .tsv, which the final pass imports. The
// JavaScriptCore summaries are cached in the build dir keyed by the pinned
// WebKit version and only recomputed with --webkit.

import { spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const toolDir = import.meta.dirname;
const args = process.argv.slice(2);

function flag(name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}
function opt(name: string, def?: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  args.splice(i, 2);
  return v;
}
function intOpt(name: string, def: number): number {
  const v = Number(opt(name, String(def)));
  if (!Number.isInteger(v) || v < 1) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
  return v;
}

if (args.includes("--help") || args.includes("-h")) {
  // The header comment of this file is the usage text.
  const lines = readFileSync(import.meta.filename, "utf8")
    .split("\n")
    .slice(1);
  const end = lines.findIndex(l => !l.startsWith("//"));
  console.log(
    lines
      .slice(0, end === -1 ? undefined : end)
      .map(l => l.replace(/^\/\/ ?/, ""))
      .join("\n"),
  );
  process.exit(0);
}

const buildDir = resolve(repo, opt("--build-dir", "build/debug")!);
const jobs = intOpt("--jobs", cpus().length);
const jsonOut = opt("--json");
const recomputeWebKit = flag("--webkit");
const webkitOnly = flag("--webkit-only");
const webkitRounds = intOpt("--webkit-rounds", 3);
const noSummaries = flag("--no-summaries");
const reuseSummaries = flag("--reuse-summaries");
const kinds = opt("--kind")?.split(",");
const onlyFiles = args.filter(a => !a.startsWith("--")).map(f => resolve(f));

const outDir = join(buildDir, "jsc-exception-lint");
mkdirSync(outDir, { recursive: true });

function llvmDir(): string {
  if (process.env.LLVM_DIR) return process.env.LLVM_DIR;
  for (const d of ["/usr/lib/llvm-21", "/usr/lib/llvm21", "/opt/homebrew/opt/llvm", "/usr/local/opt/llvm"])
    if (existsSync(d)) return d;
  throw new Error("LLVM 21 not found; set LLVM_DIR");
}

async function run(
  cmd: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = spawn({ cmd, cwd: opts.cwd ?? repo, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { code, stdout, stderr };
}

async function buildTool(): Promise<string> {
  const src = join(toolDir, "jsc-exception-lint.cpp");
  const bin = join(outDir, "jsc-exception-lint");
  if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs) return bin;
  const llvm = llvmDir();
  console.error(`building ${relative(repo, bin)} against ${llvm}`);
  const cmd = [
    "clang++",
    "-std=c++17",
    "-O2",
    "-fno-rtti",
    "-fno-exceptions",
    `-I${llvm}/include`,
    "-D_GNU_SOURCE",
    "-D__STDC_CONSTANT_MACROS",
    "-D__STDC_FORMAT_MACROS",
    "-D__STDC_LIMIT_MACROS",
    src,
    "-o",
    bin,
    `-L${llvm}/lib`,
    "-lclang-cpp",
    "-lLLVM",
    `-Wl,-rpath,${llvm}/lib`,
  ];
  const r = await run(cmd);
  if (r.code !== 0) {
    console.error(r.stderr);
    throw new Error("tool build failed");
  }
  return bin;
}

type Entry = { directory: string; arguments?: string[]; command?: string; file: string };

function loadCompileCommands(dir: string): Entry[] {
  return JSON.parse(readFileSync(join(dir, "compile_commands.json"), "utf8"));
}

// The individual bindings .cpp files, plus the unified sources that are the
// only compile entries for src/jsc/modules, src/runtime/bake and friends.
function bunSourceFiles(entries: Entry[]): string[] {
  return entries
    .map(e => e.file)
    .filter(f => f.endsWith(".cpp"))
    .filter(
      f =>
        f.includes("/src/jsc/bindings/") ||
        (f.includes("/unified/UnifiedSource-src_") && !f.includes("-src_jsc_bindings")),
    );
}

// Generated C++ (ZigGeneratedClasses.cpp, JSSink.cpp, ...). Summarized so
// calls into it are classified from its bodies; not analyzed, the generators
// own that code.
function generatedSourceFiles(entries: Entry[]): string[] {
  return entries.map(e => e.file).filter(f => f.endsWith(".cpp") && f.includes("/codegen/"));
}

// The tool parses with libclang's builtin headers; found relative to the
// compiler, not to where the tool binary happens to live.
let toolArgs: string[] = [];
async function resolveToolArgs(): Promise<void> {
  const clang = join(llvmDir(), "bin", "clang");
  if (!existsSync(clang)) return;
  const r = await run([clang, "-print-resource-dir"]);
  if (r.code === 0 && r.stdout.trim()) toolArgs = [`--extra-arg-before=-resource-dir=${r.stdout.trim()}`];
}

// Run the tool over `files` in parallel shards. Returns the concatenated stdout.
async function shardRun(bin: string, ccDir: string, files: string[], extra: string[], label: string): Promise<string> {
  const shards: string[][] = Array.from({ length: Math.min(jobs, files.length) }, () => []);
  files.forEach((f, i) => shards[i % shards.length].push(f));
  let done = 0;
  const started = Date.now();
  const outputs = await Promise.all(
    shards.map(async (shard, i) => {
      const r = await run([
        bin,
        "-p",
        ccDir,
        ...toolArgs,
        ...extra.map(a => a.replace("{shard}", String(i))),
        ...shard,
      ]);
      done += shard.length;
      if (r.code !== 0 && !r.stdout) console.error(`[${label}] shard ${i} exited ${r.code}: ${r.stderr.slice(-2000)}`);
      return r.stdout;
    }),
  );
  console.error(`[${label}] ${done} files in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  return outputs.join("");
}

// Merge per-shard summary files. "unknown" rows are leaves the analysis had
// to guess (no body anywhere); the most frequent ones are printed so they can
// be added to nothrow.txt or covered by another summary pass.
function mergeTsv(dir: string, out: string, label: string) {
  const lines = new Set<string>();
  const unknown = new Map<string, number>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsv")) continue;
    for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!l) continue;
      const cols = l.split("\t");
      if (cols[2] === "unknown") {
        unknown.set(cols[1], (unknown.get(cols[1]) ?? 0) + 1);
        continue;
      }
      lines.add(l);
    }
  }
  writeFileSync(out, [...lines].sort().join("\n") + "\n");
  const top = [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (top.length) {
    console.error(`[${label}] most frequent callees without a known body (guessed as may-throw):`);
    for (const [k, n] of top) console.error(`  ${String(n).padStart(5)}  ${k}`);
  }
}

function freshDir(d: string) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

// JavaScriptCore is compiled in the same graph, so its translation units
// (unified bundles plus the non-unified files) are in the build's compile
// database next to bun's. Returns the JSC source dir they come from (the
// pinned vendor/WebKit or a --local-deps clone) and the files to summarize.
function jscSources(entries: Entry[]): { jscDir: string; files: string[] } {
  const marker = "/Source/JavaScriptCore/";
  const inTree = entries.find(e => e.file.includes(marker) && e.file.endsWith(".cpp"));
  if (!inTree)
    throw new Error(`no JavaScriptCore sources in ${buildDir}/compile_commands.json (a --webkit=prebuilt build?)`);
  const jscDir = inTree.file.slice(0, inTree.file.indexOf(marker) + marker.length - 1);
  const files = entries
    .map(e => e.file)
    .filter(
      f =>
        (f.startsWith(jscDir + "/") && /\.(cpp|cc)$/.test(f)) ||
        /\/deps\/WebKit\/JavaScriptCore\/DerivedSources\/(unified-sources\/)?[^/]+\.cpp$/.test(f),
    );
  return { jscDir, files };
}

async function main() {
  const bin = await buildTool();
  await resolveToolArgs();
  const entries = loadCompileCommands(buildDir);
  const allBindings = bunSourceFiles(entries);
  const nothrow = join(toolDir, "nothrow.txt");
  const imports: string[] = [];

  if (!noSummaries) {
    // JavaScriptCore summaries, cached per pinned WebKit version (pass
    // --webkit to recompute, e.g. for a --local-deps clone).
    // config.ts and deps/webkit.ts import each other; loading config.ts first
    // matches the build's entry order so WEBKIT_VERSION initializes before use.
    await import("../build/config.ts");
    const { WEBKIT_VERSION } = await import("../build/deps/webkit.ts");
    const wkSummaries = join(outDir, `webkit-summaries-${WEBKIT_VERSION.slice(0, 16)}.tsv`);
    if (recomputeWebKit || !existsSync(wkSummaries)) {
      const wkDir = join(outDir, "webkit");
      freshDir(wkDir);
      const { jscDir, files: wkFiles } = jscSources(entries);
      // Each round resolves one more level of cross-file calls: a function
      // whose callee lives in another file is classified from that callee's
      // summary of the previous round.
      let previous: string | undefined;
      for (let round = 1; round <= webkitRounds; round++) {
        const tmp = join(wkDir, `round${round}`);
        freshDir(tmp);
        const importArgs = previous ? [`--import-summaries=${previous}`] : [];
        await shardRun(
          bin,
          buildDir,
          wkFiles,
          [
            "--only-under=NEVER",
            `--export-under=${jscDir}`,
            `--nothrow=${nothrow}`,
            ...importArgs,
            `--export-summaries=${tmp}/{shard}.tsv`,
          ],
          `webkit round ${round}`,
        );
        const merged = round === webkitRounds ? wkSummaries : join(wkDir, `round${round}.tsv`);
        mergeTsv(tmp, merged, `webkit round ${round}`);
        previous = merged;
      }
    }
    imports.push(wkSummaries);
    if (webkitOnly) return;

    // Bun summaries (always recomputed: the bindings are what changes). The
    // analysis pass below exports a second round, so a helper defined in
    // another translation unit is seen with the summaries of its own callees.
    // A previous run's summaries seed this one, so each run refines the
    // classification of helpers defined in another translation unit instead
    // of starting from the signature convention again.
    const previous = join(outDir, "bun-summaries.tsv");
    if (reuseSummaries && existsSync(previous)) {
      imports.push(previous);
    } else {
      const bunTmp = join(outDir, "bun-summaries");
      freshDir(bunTmp);
      const seed = existsSync(previous) ? [`--import-summaries=${previous}`] : [];
      const exportUnder = [`--export-under=${join(repo, "src")}/`, `--export-under=${join(buildDir, "codegen")}/`];
      await shardRun(
        bin,
        buildDir,
        [...allBindings, ...generatedSourceFiles(entries)],
        [
          "--only-under=NEVER",
          ...exportUnder,
          `--nothrow=${nothrow}`,
          ...imports.map(i => `--import-summaries=${i}`),
          ...seed,
          `--export-summaries=${bunTmp}/{shard}.tsv`,
        ],
        "bun summaries",
      );
      const bunSummaries = join(outDir, "bun-summaries-round1.tsv");
      mergeTsv(bunTmp, bunSummaries, "bun summaries");
      imports.push(bunSummaries);
    }
  }

  const files = onlyFiles.length ? onlyFiles : allBindings;
  const exportArgs: string[] = [];
  const bunTmp2 = join(outDir, "bun-summaries-2");
  if (!noSummaries && !onlyFiles.length) {
    freshDir(bunTmp2);
    exportArgs.push(
      `--export-under=${join(repo, "src")}/`,
      `--export-under=${join(buildDir, "codegen")}/`,
      `--export-summaries=${bunTmp2}/{shard}.tsv`,
    );
  }
  const out = await shardRun(
    bin,
    buildDir,
    files,
    [
      "--json",
      `--only-under=${join(repo, "src")}/`,
      `--nothrow=${nothrow}`,
      ...imports.map(i => `--import-summaries=${i}`),
      ...exportArgs,
    ],
    "analysis",
  );
  if (exportArgs.length) mergeTsv(bunTmp2, join(outDir, "bun-summaries.tsv"), "analysis");
  type Finding = {
    file: string;
    line: number;
    col: number;
    function: string;
    callee: string;
    kind: string;
    message: string;
  };
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const line of out.split("\n")) {
    if (!line.startsWith("{")) continue;
    const f: Finding = JSON.parse(line);
    const key = `${f.file}:${f.line}:${f.col}:${f.kind}:${f.callee}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kinds ? !kinds.includes(f.kind) : f.kind === "maybe-thrown-call") continue;
    findings.push(f);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(findings, null, 2));

  for (const f of findings)
    console.log(`${relative(repo, f.file)}:${f.line}:${f.col}: [${f.kind}] ${f.function}: ${f.message}`);

  const byKind = new Map<string, number>();
  const byCallee = new Map<string, number>();
  for (const f of findings) {
    byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    if (f.kind === "pending-call" || f.kind === "thrown-call")
      byCallee.set(f.callee, (byCallee.get(f.callee) ?? 0) + 1);
  }
  console.error(`\n${findings.length} findings in ${new Set(findings.map(f => f.file)).size} files`);
  for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.error(`  ${k}: ${n}`);
  console.error("\ntop callees flagged while a check is pending:");
  for (const [k, n] of [...byCallee].sort((a, b) => b[1] - a[1]).slice(0, 40))
    console.error(`  ${String(n).padStart(5)}  ${k}`);
}

await main();
