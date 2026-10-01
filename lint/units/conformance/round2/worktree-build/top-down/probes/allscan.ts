// The JS units of the corpus (simplified split at "// @filename:") through the rules, 450 files per process, one process at a time.
const BIN = process.argv[2];
const asan = process.argv[3];
const root = "/tmp/conf-wb-1b/allunits";
const files = (await Bun.file("/tmp/conf-wb-1b/allunits.list").text()).split("\n").filter(Boolean);
const env: Record<string, string> = { PATH: "/tmp/conf-wb-1b/fakebin:" + process.env.PATH, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" };
if (asan) env.ASAN_OPTIONS = asan;
const codes: Record<string, number> = {};
let all = "";
const t00 = performance.now();
for (let i = 0; i < files.length; i += 1500) {
  const batch = files.slice(i, i + 1500);
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
  console.log(`batch ${i / 1500}: ${batch.length} files, exit=${proc.exitCode} signal=${proc.signalCode}, ${Math.round(performance.now() - t0)} ms, stdout ${stdout.length} bytes, stderr ${lines.length} lines, of no known form ${odd.length}${odd.length ? ": " + JSON.stringify(odd.slice(0, 3)) : ""}`);
}
console.log(`total ${Math.round(performance.now() - t00)} ms over ${files.length} files; by category and code: ${JSON.stringify(codes)}`);
await Bun.write(`/tmp/conf-wb-1b/allscan-${process.argv[4]}.stderr.txt`, all);
