/**
 * Runs a list of bun's own test files with one binary or more and records what each reports.
 *
 *   bun image/run-tests.ts <list.txt> <out.json> <label>=<binary> [<label>=<binary> ...]
 *
 * <list.txt>: one test file per line, relative to the root of the repository (# starts a comment).
 * Every file is run as `<binary> test <file>` with the repository's test/ configuration, one run at a time,
 * with the environment bun's own runner gives a test (test/harness.ts bunEnv), and a time limit
 * ($TEST_TIMEOUT_MS, 180000). The counts are read from the summary `bun test` prints (" N pass", " N fail",
 * " N skip"). Next to <out.json>: test-logs/ (what every run printed) and test-install-cache/.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPOSITORY } from "../flags.ts";

const tree = REPOSITORY;
const [listPath, outPath, ...binaries] = process.argv.slice(2);
if (listPath === undefined || outPath === undefined || binaries.length === 0) {
  console.error("usage: bun image/run-tests.ts <list.txt> <out.json> <label>=<binary> ...");
  process.exit(2);
}
const timeoutMs = Number(process.env.TEST_TIMEOUT_MS ?? 180_000);
const installCache = join(dirname(resolve(outPath)), "test-install-cache");
const files = readFileSync(listPath, "utf8")
  .split("\n")
  .map(l => l.replace(/#.*$/, "").trim())
  .filter(l => l !== "");

interface Run {
  exit: number | string;
  timed_out: boolean;
  seconds: number;
  pass: number | null;
  fail: number | null;
  skip: number | null;
  todo: number | null;
  /** passed: exit 0, at least one test passed, none failed */
  ok: boolean;
  log: string;
}

function run(binary: string, file: string, logPath: string): Promise<Run> {
  return new Promise(resolve => {
    const started = Date.now();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      // test/harness.ts bunEnv, the part that decides what a test prints and reaches
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      BUN_INSTALL_CACHE_DIR: installCache,
      GITHUB_ACTIONS: "false",
      CI: "false",
    };
    delete env.BUN_PORTABLE_SYSROOT;
    const child = spawn(binary, ["test", file], { cwd: tree, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, output);
      const count = (what: string): number | null => {
        const m = new RegExp(`^\\s*(\\d+) ${what}\\b`, "m").exec(output);
        return m === null ? null : Number(m[1]);
      };
      const pass = count("pass");
      const fail = count("fail");
      resolve({
        exit: code ?? signal ?? "?",
        timed_out: timedOut,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        pass,
        fail,
        skip: count("skip"),
        todo: count("todo"),
        ok: code === 0 && !timedOut && (pass ?? 0) > 0 && (fail ?? 0) === 0,
        log: logPath,
      });
    });
  });
}

const labels = binaries.map(b => {
  const eq = b.indexOf("=");
  return { label: b.slice(0, eq), binary: resolve(b.slice(eq + 1)) };
});
const logDir = join(dirname(resolve(outPath)), "test-logs");
const results: Record<string, Record<string, Run>> = {};
for (const file of files) {
  results[file] = {};
  for (const { label, binary } of labels) {
    const logPath = join(logDir, label, file.replace(/[/\\]/g, "__") + ".log");
    const r = await run(binary, file, logPath);
    results[file]![label] = r;
    console.log(
      `${r.ok ? "ok  " : "FAIL"} ${label.padEnd(9)} ${file}  pass=${r.pass} fail=${r.fail} skip=${r.skip} exit=${r.exit}${r.timed_out ? " TIMEOUT" : ""} ${r.seconds}s`,
    );
  }
}

const summary = Object.fromEntries(
  labels.map(({ label, binary }) => {
    const runs = files.map(f => results[f]![label]!);
    return [
      label,
      {
        binary,
        files: runs.length,
        files_passed: runs.filter(r => r.ok).length,
        tests_passed: runs.reduce((a, r) => a + (r.pass ?? 0), 0),
        tests_failed: runs.reduce((a, r) => a + (r.fail ?? 0), 0),
        tests_skipped: runs.reduce((a, r) => a + (r.skip ?? 0), 0),
      },
    ];
  }),
);
const [first, second] = labels;
const differences =
  first !== undefined && second !== undefined
    ? files
        .filter(f => {
          const a = results[f]![first.label]!;
          const b = results[f]![second.label]!;
          return a.ok !== b.ok || a.pass !== b.pass || a.fail !== b.fail || a.skip !== b.skip;
        })
        .map(f => ({ file: f, [first.label]: results[f]![first.label], [second.label]: results[f]![second.label] }))
    : [];
writeFileSync(outPath, JSON.stringify({ timeout_ms: timeoutMs, files, summary, differences, results }, null, 1) + "\n");
console.log(JSON.stringify({ summary, differing_files: differences.map(d => d.file) }, null, 1));
