/**
 * Two-stage PGO build for the `btg` (bench-till-green) profile.
 *
 *   bun run build:btg:pgo
 *   bun scripts/build-pgo.ts [--gen-dir=build/btg-pgo] [build flags...] [-- <exec args>]
 *
 * Why this exists
 * ───────────────
 * The plain `btg` link has no profile, so the cold-start working set
 * (clap → CLI dispatch → module loader → js_parser/js_printer bring-up → JSC
 * VM init) is scattered across the ~54 MB `.text`; each hot fn drags in a
 * 64 KB fault-around window of cold neighbours (≈ +1.3 MB resident `.text`
 * vs the PGO+BOLT'd shipped `bun`). A real profile lets clang AND rustc emit
 * `.text.hot` / `.text.unlikely` from *measured* counts, and `--pgo-use`
 * flips on `-z keep-text-section-prefix` (see scripts/build/flags.ts) so lld
 * keeps that split — the hot run of `.text` then clusters contiguously. This
 * supersedes the hand-authored src/startup.order approximation.
 *
 * What it does
 * ────────────
 *   1. build  an instrumented `bun`  → build/btg-pgo-gen
 *             (`--profile=btg --pgo-generate=<gen-dir>/raw`)
 *   2. train  run a representative workload with the instrumented binary so it
 *             drops `.profraw` files into <gen-dir>/raw  (each command is
 *             best-effort: a non-zero exit still leaves useful coverage)
 *   3. merge  `llvm-profdata merge`  →  <gen-dir>/btg.profdata
 *   4. relink the real `bun`  → build/btg  (`--profile=btg --pgo-use=...`)
 *
 * Extra build flags before `--` are forwarded to BOTH builds (e.g. `-j8`,
 * `--baseline=on`). Anything after `--` (or the first bare positional) is
 * passed to the final `bun` like `bun run build:btg <args>` would.
 *
 * `llvm-profdata` is taken from $LLVM_PROFDATA, else the dir of the build's
 * clang, else PATH (`llvm-profdata`, then `llvm-profdata-NN`). It must match
 * the LLVM that built the instrumented binary, or `merge` will reject the
 * `.profraw` version — set $LLVM_PROFDATA if autodetection picks wrong.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { BuildError } from "./build/error.ts";

const ROOT = resolve(import.meta.dirname, "..");
const BUN = process.execPath;
const BUILD_TS = join(ROOT, "scripts", "build.ts");

try {
  await main();
} catch (err) {
  if (err instanceof BuildError) {
    process.stderr.write(err.format());
    process.exit(1);
  }
  throw err;
}

async function main(): Promise<void> {
  const { genDir, passThrough, execArgs } = parseArgs(process.argv.slice(2));
  const rawDir = join(genDir, "raw");
  const profData = join(genDir, "btg.profdata");
  const genBuildDir = join(ROOT, "build", "btg-pgo-gen");

  // ── 1. instrumented build ────────────────────────────────────────────────
  group("PGO 1/4 — build instrumented bun");
  mkdirSync(genDir, { recursive: true });
  run(BUN, [BUILD_TS, "--profile=btg", `--pgo-generate=${rawDir}`, `--build-dir=${genBuildDir}`, ...passThrough]);

  const instrumentedBun = ["bun", "bun-profile", "bun-debug", "bun.exe"]
    .map(name => join(genBuildDir, name))
    .find(existsSync);
  if (!instrumentedBun) {
    throw new BuildError(`instrumented bun binary not found in ${genBuildDir}`, {
      hint: "Stage 1 build appears to have failed.",
    });
  }

  // ── 2. train ─────────────────────────────────────────────────────────────
  group("PGO 2/4 — train (collect .profraw)");
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  trainWorkload(instrumentedBun, rawDir);

  const profraws = readdirSync(rawDir)
    .filter(f => f.endsWith(".profraw"))
    .map(f => join(rawDir, f));
  if (profraws.length === 0) {
    throw new BuildError("no .profraw files produced by the training workload", {
      hint: "The instrumented binary may have crashed before exit, or LLVM_PROFILE_FILE was overridden.",
    });
  }
  process.stderr.write(`  collected ${profraws.length} .profraw file(s)\n`);

  // ── 3. merge ─────────────────────────────────────────────────────────────
  group("PGO 3/4 — llvm-profdata merge");
  const llvmProfdata = findLlvmProfdata();
  run(llvmProfdata, ["merge", `-output=${profData}`, ...profraws]);
  process.stderr.write(`  wrote ${profData}\n`);

  // ── 4. optimized relink ──────────────────────────────────────────────────
  group("PGO 4/4 — relink build/btg with the profile");
  run(BUN, [BUILD_TS, "--profile=btg", `--pgo-use=${profData}`, ...passThrough, ...execArgs]);
}

// ───────────────────────────────────────────────────────────────────────────
// training workload
// ───────────────────────────────────────────────────────────────────────────

/**
 * Exercise the paths that dominate bun's cold start: clap arg-parse + CLI
 * dispatch, `bun run <script>` npm-script lookup/spawn (incl. `--bun` mode),
 * the module loader + CJS-wrap/transpile hot loop (at module-graph scale, not
 * just a couple files), the transpiler (js_parser/js_printer), the bundler +
 * sourcemap chunk builder, and a touch of webcore. Every step is best-effort —
 * a non-zero exit (e.g. from `bun -e`) still leaves the already-executed code's
 * counters in the `.profraw`.
 */
function trainWorkload(bun: string, rawDir: string): void {
  // %m = binary signature, %p = pid → one distinct .profraw per run.
  const env = { ...process.env, LLVM_PROFILE_FILE: join(rawDir, "bun-%m-%p.profraw"), BUN_DEBUG_QUIET_LOGS: "1" };
  const train = (args: string[], cwd?: string) => run(bun, args, { cwd, env, allowFail: true, quiet: true });

  // CLI dispatch + version/banner paths.
  train(["--version"]);
  train(["--revision"]);
  train(["--help"]);

  // Module loader: resolve + load + transpile a spread of node builtins (the
  // `require("fs")`-class startup hot path).
  train([
    "-e",
    "for (const m of ['fs','path','os','crypto','util','events','stream','buffer','url','http','net','tls','zlib','process','child_process','assert','string_decoder','querystring']) require(m);",
  ]);

  // A bit of runtime/webcore: JSON, encoders, Buffer, hashing, Bun.file.
  train([
    "-e",
    "const s=JSON.stringify({a:1,b:[1,2,3,4,5],c:'x'.repeat(256),d:{e:true,f:null}});JSON.parse(s);new TextEncoder().encode(s);new TextDecoder().decode(new TextEncoder().encode(s));Buffer.from(s).toString('base64');Bun.hash(s);Bun.file(import.meta.path);typeof Bun.version;",
  ]);

  // Short HTTP round-trip — uWS / http / webcore (best-effort: ignore failures).
  train([
    "-e",
    "const srv=Bun.serve({port:0,fetch:()=>new Response('ok')});const r=await fetch(srv.url);await r.text();srv.stop(true);",
  ]);

  // `bun run <package.json script>` — the npm-script lookup + child-spawn path
  // and `--bun`-mode node→bun shebang redirect. Cold start for `bun --bun lint`
  // & friends (npm-run-all `run-s` in bun → `bun run lint:*` → tool) goes
  // through RunCommand::exec → arguments::parse(RUN_TABLE) → script resolution →
  // spawn, none of which the -e / build / test steps above sample.
  const pkgDir = join(rawDir, "_train_pkg");
  mkdirSync(join(pkgDir, "bin"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "_pgo_train",
      private: true,
      scripts: { noop: "bun ./bin/noop.mjs --flag a b", chain: "bun run noop", "via-node": "node ./bin/noop.mjs" },
    }),
  );
  writeFileSync(join(pkgDir, "bin", "noop.mjs"), "void process.argv.slice(2);\nprocess.exitCode = 0;\n");
  train(["run", "noop"], pkgDir);
  train(["run", "chain"], pkgDir); // run-script → run-script (npm-run-all `run-s` shape)
  train(["--bun", "run", "via-node"], pkgDir); // exercises the node→bun shebang redirect

  // Heavy CJS/TS module-graph transpile — the `require()`-wrap + resolver +
  // parser hot loop that dominates `bun --bun <lint-tool>` (eslint + plugins =
  // hundreds of node_modules files). Synthesize a fan-out DAG so the profile
  // covers the CJS wrapper at scale, not just the handful of files `-e` /
  // `bun build` above touch.
  const graphDir = join(rawDir, "_train_graph");
  mkdirSync(graphDir, { recursive: true });
  const MODS = 48;
  for (let i = 0; i < MODS; i++) {
    const deps = [i + 1, i + 2, i + 5].filter(j => j < MODS);
    const reqs = deps.map(j => `const m${j} = require("./m${j}.js");`).join("\n");
    const sum = deps.map(j => `m${j}.v`).join(" + ") || "0";
    writeFileSync(
      join(graphDir, `m${i}.js`),
      `${reqs}\nconst extra = { a: ${i}, b: "x".repeat(${i % 17}), c: [${deps.join(",")}] };\n` +
        `function compute() { let s = ${i}; for (let k = 0; k < 8; k++) s = (s * 31 + k) >>> 0; return s; }\n` +
        `module.exports = { v: ${i} + ${sum} + compute() * 0, extra, compute };\n`,
    );
  }
  writeFileSync(
    join(graphDir, "m0.ts"),
    `import * as root from "./m0.js";\nexport interface Bag { readonly v: number }\nexport const b: Bag = { v: root.v };\n`,
  );
  writeFileSync(
    join(graphDir, "entry.ts"),
    `import "./m0.ts";\nfor (let i = 0; i < ${MODS}; i++) require("./m" + i + ".js");\n`,
  );
  train(["run", join(graphDir, "entry.ts")], pkgDir);

  // Transpiler coverage on real, non-trivial TypeScript: run a chunk of the
  // build tooling itself. `--help` transpiles build.ts + its direct imports;
  // `--configure-only` additionally runs configure() (flags.ts, rules.ts,
  // deps/*.ts, …) and writes a build.ninja but never invokes ninja.
  train([BUILD_TS, "--help"]);
  train([BUILD_TS, "--profile=release", "--configure-only", `--build-dir=${join(rawDir, "_cfgprobe")}`]);

  // Bundler + printer + sourcemap chunk builder.
  const sample = join(rawDir, "_train_sample.ts");
  writeFileSync(sample, SAMPLE_TS);
  const out = join(rawDir, "_train_sample.out.js");
  const min = join(rawDir, "_train_sample.min.js");
  train(["build", sample, "--target=bun", "--outfile", out]);
  train(["build", sample, "--target=bun", "--minify", "--sourcemap=linked", "--outfile", min]);

  // Test runner bring-up (transpiles + executes a tiny test file).
  const test = join(rawDir, "_train.test.ts");
  writeFileSync(
    test,
    "import {test,expect} from 'bun:test';test('pgo',()=>{expect(1+1).toBe(2);expect([1,2,3].map(x=>x*2)).toEqual([2,4,6]);});",
  );
  train(["test", test]);
}

const SAMPLE_TS = `import { join } from "node:path";
export interface Pt { x: number; y: number }
export class Vec implements Pt {
  constructor(public x = 0, public y = 0) {}
  add(o: Pt): Vec { return new Vec(this.x + o.x, this.y + o.y); }
  get len(): number { return Math.hypot(this.x, this.y); }
}
type Pair<T> = readonly [T, T];
const mk = (n: number): Vec[] => Array.from({ length: n }, (_, i) => new Vec(i, i * 2));
export async function reduceSum(pts: readonly Pt[]): Promise<number> {
  let s = 0;
  for (const { x, y } of pts) s += x + y;
  await Promise.resolve();
  return s;
}
export const tag = (x: unknown): Pair<string> => [typeof x, String(x)] as const;
const data = mk(2048);
reduceSum(data).then(t => { if (t < 0) throw new Error(join("never", String(t))); });
export default { Vec, mk, reduceSum, tag };
`;

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  genDir: string;
  /** Build flags forwarded to both stages (everything starting with `-`). */
  passThrough: string[];
  /** Args for the final `bun` (after `--`, or from the first bare positional). */
  execArgs: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  let genDir = join(ROOT, "build", "btg-pgo");
  const passThrough: string[] = [];
  const execArgs: string[] = [];
  let inExec = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (inExec) {
      execArgs.push(a);
      continue;
    }
    if (a === "--") {
      inExec = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    const eq = /^--gen-dir=(.+)$/.exec(a);
    if (eq) {
      genDir = eq[1]!;
      continue;
    }
    if (a === "--gen-dir") {
      const v = argv[++i];
      if (v === undefined) throw new BuildError("--gen-dir requires a value");
      genDir = v;
      continue;
    }
    if (a.startsWith("-")) {
      passThrough.push(a);
      continue;
    }
    // First bare positional → start of exec args.
    inExec = true;
    execArgs.push(a);
  }

  return { genDir: isAbsolute(genDir) ? genDir : resolve(ROOT, genDir), passThrough, execArgs };
}

function usage(): string {
  return [
    "Two-stage PGO build for the `btg` profile.",
    "",
    "  bun run build:btg:pgo [--gen-dir=DIR] [build flags...] [-- <exec args>]",
    "",
    "  --gen-dir=DIR   where to put .profraw + btg.profdata (default: build/btg-pgo)",
    "  build flags     forwarded to both `scripts/build.ts` invocations (e.g. -j8)",
    "  -- <exec args>  passed to the final `bun` (like `bun run build:btg <args>`)",
    "",
    "Output: build/btg/bun (PGO-optimized).  $LLVM_PROFDATA overrides the",
    "llvm-profdata used for the merge step.",
    "",
  ].join("\n");
}

function group(label: string): void {
  process.stderr.write(`\n\x1b[1m── ${label} ──\x1b[0m\n`);
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; allowFail?: boolean; quiet?: boolean } = {},
): boolean {
  if (!opts.quiet) process.stderr.write(`\x1b[2m$ ${cmd} ${args.join(" ")}\x1b[0m\n`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: opts.env ?? process.env,
    stdio: "inherit",
  });
  if (r.error) {
    if (opts.allowFail) {
      process.stderr.write(`  (skipped: ${r.error.message})\n`);
      return false;
    }
    throw new BuildError(`failed to spawn ${cmd}`, { cause: r.error });
  }
  if (r.signal) {
    if (opts.allowFail) {
      process.stderr.write(`  (killed by ${r.signal}, continuing)\n`);
      return false;
    }
    throw new BuildError(`${cmd} killed by signal ${r.signal}`);
  }
  if (r.status !== 0) {
    if (opts.allowFail) {
      process.stderr.write(`  (exit ${r.status}, continuing)\n`);
      return false;
    }
    process.exit(r.status ?? 1);
  }
  return true;
}

/**
 * Resolve `llvm-profdata`. Order: $LLVM_PROFDATA → dir of the build's clang →
 * PATH (`llvm-profdata`, then `llvm-profdata-NN` newest-first).
 */
function findLlvmProfdata(): string {
  const fromEnv = process.env.LLVM_PROFDATA;
  if (fromEnv) {
    if (isAbsolute(fromEnv) && !existsSync(fromEnv)) {
      throw new BuildError(`$LLVM_PROFDATA points at a missing file: ${fromEnv}`);
    }
    return fromEnv;
  }

  const which = (name: string): string | undefined => {
    try {
      // Bun runtime: use Bun.which when available.
      const w = (globalThis as { Bun?: { which?: (n: string) => string | null } }).Bun?.which;
      if (w) return w(name) ?? undefined;
    } catch {}
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
    const line = r.status === 0 ? r.stdout.split(/\r?\n/).find(Boolean) : undefined;
    return line?.trim() || undefined;
  };

  const candidates: string[] = [];
  const clang = which("clang") ?? which("clang++") ?? which("clang-cl");
  if (clang) {
    const sibling = join(dirname(clang), process.platform === "win32" ? "llvm-profdata.exe" : "llvm-profdata");
    if (existsSync(sibling)) return sibling;
  }
  candidates.push("llvm-profdata");
  for (let v = 25; v >= 14; v--) candidates.push(`llvm-profdata-${v}`);
  for (const c of candidates) {
    const found = which(c);
    if (found) return found;
  }

  throw new BuildError("llvm-profdata not found", {
    hint:
      "Install LLVM tools (the `llvm` package, or Xcode CLT on macOS), or set " +
      "LLVM_PROFDATA=/path/to/llvm-profdata — it must match the LLVM that built " +
      "the instrumented binary.",
  });
}
