// Every raw case file of the corpus as an operand, 1000 per process, one process at a time: does the binary survive them all?
// (A case with "// @filename:" sections is read as one file here: this is a robustness scan, not the sweep.)
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BIN = process.argv[2];
const tag = process.argv[3];
const asan = process.argv[4];
const root = "/tmp/conf-wb-1b/scratch/test/cli/lint/conformance/corpus/cases";
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    const rel = dir === "" ? name : dir + "/" + name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else files.push(rel);
  }
})("");
const env: Record<string, string> = { PATH: "/tmp/conf-wb-1b/fakebin:" + process.env.PATH, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" };
if (asan) env.ASAN_OPTIONS = asan;
console.log(`# ${BIN} over ${files.length} files`);
let all = "";
const t00 = performance.now();
const codes: Record<string, number> = {};
const from = Number(process.argv[5] ?? 0) * 1000, to = Number(process.argv[6] ?? 99) * 1000;
for (let i = from; i < Math.min(files.length, to); i += 1000) {
  const batch = files.slice(i, i + 1000);
  const t0 = performance.now();
  const proc = Bun.spawn({ cmd: [BIN, "--lint", ...batch], cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 300_000, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  all += stderr;
  const lines = stderr.split("\n").filter(l => l !== "");
  const odd = lines.filter(l => !/^(\S.*?\(\d+,\d+\): )?(error|warning|suggestion|message) [A-Za-z@][A-Za-z0-9@\/_-]*: /.test(l));
  for (const l of lines) {
    const m = /(?:\): |^)(error|warning) ([A-Za-z@][A-Za-z0-9@\/_-]*): /.exec(l);
    if (m) codes[m[1] + " " + m[2]] = (codes[m[1] + " " + m[2]] ?? 0) + 1;
  }
  console.log(`batch ${i / 1000}: ${batch.length} files, exit=${proc.exitCode} signal=${proc.signalCode}, ${Math.round(performance.now() - t0)} ms, stdout ${stdout.length} bytes, stderr ${lines.length} lines, lines of no known form ${odd.length}${odd.length ? ": " + JSON.stringify(odd.slice(0, 3)) : ""}`);
}
console.log(`total ${Math.round(performance.now() - t00)} ms; diagnostics by category and code: ${JSON.stringify(codes)}`);
writeFileSync(`/tmp/conf-wb-1b/rawscan-${tag}.stderr.txt`, all);
