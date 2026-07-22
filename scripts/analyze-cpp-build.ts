#!/usr/bin/env bun
/**
 * Profile the C++ build step.
 *
 * Does a clean release cpp-only build with clang's -ftime-trace in a dedicated
 * build directory, then produces two reports:
 *
 *   1. Wall-clock view — parses ninja's .ninja_log to show per-edge durations,
 *      category breakdown, and what's on the critical path. This is what
 *      actually determines "how long the build takes".
 *
 *   2. Compiler-time view — runs ClangBuildAnalyzer over every .json trace
 *      clang emitted to show which headers / templates / instantiations eat
 *      aggregate frontend time. This is what to fix to make the wall clock
 *      shorter.
 *
 * Usage:
 *   bun scripts/analyze-cpp-build.ts              # clean build + analyze
 *   bun scripts/analyze-cpp-build.ts --no-build   # analyze an existing build dir
 *   bun scripts/analyze-cpp-build.ts --dir build/my-experiment
 *   bun scripts/analyze-cpp-build.ts --lto=off    # profile non-LTO
 *
 * The build directory defaults to build/time-trace and is separate from
 * build/release so profiling never perturbs your normal cache.
 *
 * Interpreting the output:
 *   - "Expensive headers" with high include-count × avg-ms → candidates for
 *     root-pch.h (every TU that includes them re-parses the same bytes).
 *   - A single unified bundle much slower than its siblings → one of its
 *     members belongs in unified.ts's noUnify list.
 *   - Large "Templates that took longest to instantiate" with N× instantiations
 *     → extern-template declarations, or move the instantiating header to PCH.
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function run(argv: string[], opts: SpawnSyncOptions): void {
  const r = spawnSync(argv[0]!, argv.slice(1), opts);
  if (r.error) {
    console.error(`failed to spawn ${argv[0]}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string): string | undefined => {
  const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return dflt;
  const a = args[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (args[i + 1] ?? "");
};
const has = (name: string) => args.includes(`--${name}`);

const repo = resolve(import.meta.dir, "..");
const buildDir = resolve(repo, flag("dir") || "build/time-trace");
// The default clean step is rmSync(buildDir, {recursive}). Refuse any buildDir
// that is the repo root or an ancestor of it (which is what --dir "", --dir .,
// --dir / all resolve to) so a typo can't recursively delete the checkout.
{
  // On Windows, relative() across drive roots returns the absolute `to` path;
  // a buildDir on a different drive cannot contain the repo, so allow it.
  const repoFromBuild = relative(buildDir, repo);
  if (
    repoFromBuild === "" ||
    !(repoFromBuild === ".." || repoFromBuild.startsWith(`..${sep}`) || isAbsolute(repoFromBuild))
  ) {
    console.error(`refusing --dir ${JSON.stringify(buildDir)}: contains the repository root`);
    process.exit(1);
  }
}
const lto = flag("lto", "on");
const top = Number(flag("top", "25"));
const noBuild = has("no-build");
const noClean = has("no-clean");

// ───────────────────────────────────────────────────────────────────────────
// ClangBuildAnalyzer — fetched once into the shared build cache.
// ───────────────────────────────────────────────────────────────────────────

const cbaVersion = "1.6.0";
async function resolveClangBuildAnalyzer(): Promise<string> {
  // A system install always wins — it's the only option on platforms without
  // a matching prebuilt (the upstream release ships x64-only binaries).
  const system = Bun.which("ClangBuildAnalyzer");
  if (system) return system;
  if (process.platform === "linux" && process.arch !== "x64") {
    throw new Error(
      `ClangBuildAnalyzer v${cbaVersion} has no linux-${process.arch} prebuilt; ` +
        `build it from source (github.com/aras-p/ClangBuildAnalyzer) and put it on PATH`,
    );
  }
  const cacheRoot =
    process.env.BUN_BUILD_CACHE ??
    resolve(process.env.BUN_INSTALL ?? `${process.env.HOME ?? process.env.USERPROFILE}/.bun`, "build-cache");
  const suffix = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows.exe" : "linux";
  const bin = resolve(
    cacheRoot,
    "tools",
    `ClangBuildAnalyzer-${cbaVersion}${process.platform === "win32" ? ".exe" : ""}`,
  );
  if (existsSync(bin)) return bin;
  const url = `https://github.com/aras-p/ClangBuildAnalyzer/releases/download/v${cbaVersion}/ClangBuildAnalyzer-${suffix}`;
  console.error(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  mkdirSync(dirname(bin), { recursive: true });
  // .partial + rename: an interrupted fetch would otherwise leave a truncated
  // file that existsSync() above happily reuses forever (same idiom as
  // scripts/build/download.ts).
  const partial = `${bin}.${process.pid}.partial`;
  await Bun.write(partial, res);
  if (process.platform !== "win32") chmodSync(partial, 0o755);
  renameSync(partial, bin);
  return bin;
}

// ───────────────────────────────────────────────────────────────────────────
// .ninja_log — wall-clock per-edge timing.
// ───────────────────────────────────────────────────────────────────────────

interface Edge {
  start: number;
  end: number;
  out: string;
}

function readNinjaLog(dir: string): Edge[] {
  const path = resolve(dir, ".ninja_log");
  if (!existsSync(path)) throw new Error(`no .ninja_log at ${path} — run a build first`);
  // Last entry per output wins (ninja appends on every build).
  const byOut = new Map<string, Edge>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("#") || !line.includes("\t")) continue;
    const [s, e, , out] = line.split("\t");
    if (!out) continue;
    byOut.set(out, { start: +s, end: +e, out });
  }
  return [...byOut.values()];
}

function categorize(out: string): string {
  if (out.endsWith(".pch")) return "pch";
  if (out.startsWith("obj/unified/")) return "cxx (unified)";
  if (out.startsWith("obj/codegen/")) return "cxx (codegen)";
  if (out.startsWith("obj/vendor/")) return "cc/cxx (deps)";
  if (out.startsWith("obj/") && (out.endsWith(".o") || out.endsWith(".obj"))) return "cxx (standalone)";
  if (out.startsWith("codegen/")) return "codegen script";
  if (out.endsWith(".a") || out.endsWith(".lib")) return "archive";
  if (out.includes("/webkit-") || out.includes("tarballs/") || out.endsWith(".ref")) return "fetch";
  return "other";
}

function reportNinjaLog(edges: Edge[]): void {
  console.log(`\n━━━ wall-clock (.ninja_log) ━━━`);
  if (edges.length === 0) {
    console.log(`  no edges recorded in ${buildDir}/.ninja_log — run without --no-build first.`);
    return;
  }
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const minStart = Math.min(...edges.map(e => e.start));
  const maxEnd = Math.max(...edges.map(e => e.end));
  const wall = maxEnd - minStart;
  const sum = edges.reduce((a, e) => a + (e.end - e.start), 0);

  console.log(
    `  ${edges.length} edges   wall: ${fmt(wall)}   Σduration: ${fmt(sum)}   parallelism≈${(sum / wall).toFixed(1)}×\n`,
  );

  const cats = new Map<string, { n: number; ms: number }>();
  for (const e of edges) {
    const k = categorize(e.out);
    const c = cats.get(k) ?? { n: 0, ms: 0 };
    c.n++;
    c.ms += e.end - e.start;
    cats.set(k, c);
  }
  console.log(`  by category:`);
  for (const [k, v] of [...cats].sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(
      `    ${k.padEnd(18)} ${String(v.n).padStart(5)} edges   ${fmt(v.ms).padStart(8)}  (${((v.ms / sum) * 100).toFixed(1)}%)`,
    );
  }

  console.log(`\n  slowest ${top} edges:`);
  for (const e of [...edges].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, top)) {
    console.log(`    ${fmt(e.end - e.start).padStart(8)}  ${e.out}`);
  }

  // Unified-bundle balance: imbalance here is critical-path waste.
  const bundles = edges.filter(e => /obj\/unified\/UnifiedSource-.*\.(o|obj)$/.test(e.out));
  const byGroup = new Map<string, Edge[]>();
  for (const b of bundles) {
    const m = /UnifiedSource-(.+?)-\d+\./.exec(b.out);
    if (!m) continue;
    (byGroup.get(m[1]!) ?? byGroup.set(m[1]!, []).get(m[1]!)!).push(b);
  }
  console.log(`\n  unified-bundle balance (max/min per directory group):`);
  for (const [g, bs] of [...byGroup].sort(
    (a, b) => Math.max(...b[1].map(e => e.end - e.start)) - Math.max(...a[1].map(e => e.end - e.start)),
  )) {
    if (bs.length < 2) continue;
    const ds = bs.map(b => b.end - b.start).sort((a, b) => b - a);
    const max = ds[0]!;
    const min = ds[ds.length - 1]!;
    const ratio = max / min;
    const flag = ratio >= 1.5 ? "  ⟵ imbalanced" : "";
    console.log(`    ${g.padEnd(40)} ${bs.length}×   max ${fmt(max)}  min ${fmt(min)}  (${ratio.toFixed(1)}×)${flag}`);
  }

  // Crude critical path: longest chain of (pch) → (slowest cxx that waits on
  // pch). Real critical path needs the full dep graph; this approximation is
  // what matters in practice since every cxx_pch edge waits on the PCH.
  const pch = edges.find(e => e.out.endsWith(".pch"));
  const slowestCxx = [...edges]
    .filter(e => e.out.startsWith("obj/") && (e.out.endsWith(".o") || e.out.endsWith(".obj")))
    .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (pch && slowestCxx) {
    console.log(
      `\n  critical-path floor (pch → slowest cxx): ` +
        `${fmt(pch.end - pch.start)} + ${fmt(slowestCxx.end - slowestCxx.start)} = ` +
        `${fmt(pch.end - pch.start + (slowestCxx.end - slowestCxx.start))}`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// main
// ───────────────────────────────────────────────────────────────────────────

const cba = await resolveClangBuildAnalyzer();

if (!noBuild) {
  if (!noClean && existsSync(buildDir)) {
    console.error(`cleaning ${buildDir}`);
    rmSync(buildDir, { recursive: true, force: true });
  }
  console.error(`building (release, cpp-only, lto=${lto}, timeTrace) → ${buildDir}`);
  run(
    [
      process.execPath,
      resolve(repo, "scripts/build.ts"),
      "--profile=release",
      "--mode=cpp-only",
      `--lto=${lto}`,
      "--timeTrace=on",
      `--buildDir=${buildDir}`,
    ],
    { stdio: "inherit", cwd: repo },
  );
}

reportNinjaLog(readNinjaLog(buildDir));

// ClangBuildAnalyzer: aggregate every -ftime-trace json under buildDir. Its
// ini file must live in the CWD it's invoked from; write a transient one next
// to the capture so section counts are useful (defaults are tiny).
const capture = resolve(buildDir, "time-trace.capture");
const ini = resolve(buildDir, "ClangBuildAnalyzer.ini");
await Bun.write(ini, `[counts]\nfileParse=20\nfileCodegen=15\nfunction=0\ntemplate=30\nheader=30\nheaderChain=5\n`);
run([cba, "--all", buildDir, capture], { stdio: ["ignore", "ignore", "inherit"] });

console.log(`\n━━━ compiler time (-ftime-trace, ClangBuildAnalyzer) ━━━`);
run([cba, "--analyze", capture], { stdio: "inherit", cwd: buildDir });
