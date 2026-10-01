// Rows 2 to 8 and 10 of the refusal table of cli's API.md, against the real binary. stdin is closed.
const BIN = "/workspace/wt/conformance/build/debug/bun-debug";
const P = "/tmp/conf-wb-1b/probe";
const env = { PATH: process.env.PATH!, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
const rows: [string, string[]][] = [
  ["2 --lint -e CODE", ["--lint", "-e", "console.log('evaluated')"]],
  ["3 --lint -p CODE", ["--lint", "-p", "'printed'"]],
  ["5 --lint --watch x.ts", ["--lint", "--watch", "clean.ts"]],
  ["6 --lint --hot x.ts", ["--lint", "--hot", "clean.ts"]],
  ["7 --lint --filter '*' s", ["--lint", "--filter", "*", "clean.ts"]],
  ["8 --lint --parallel s", ["--lint", "--parallel", "clean.ts"]],
  ["10 repl --lint", ["repl", "--lint"]],
  ["x.ts --lint (flag after the file: the file runs)", ["ran-marker.ts", "--lint"]],
];
await Bun.write(P + "/ran-marker.ts", 'console.log("the file ran, argv:", process.argv.slice(2).join(" "));\n');
for (const [name, args] of rows) {
  const proc = Bun.spawn({ cmd: [BIN, ...args], cwd: P, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(`row ${name}: exit=${proc.exitCode} signal=${proc.signalCode} stdout=${JSON.stringify(stdout.slice(0, 120))} stderr=${JSON.stringify(stderr.slice(0, 200))}`);
}
