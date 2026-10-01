// What a lint child that dies looks like to the runner: a signal is sent while it parses a 1 MB file.
const BIN = process.argv[2];
const sig = process.argv[3] ?? "SIGSEGV";
const asan = process.argv[4];
const env: Record<string, string> = { PATH: process.env.PATH!, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
if (asan) env.ASAN_OPTIONS = asan;
const t0 = performance.now();
const proc = Bun.spawn({ cmd: [BIN, "--lint", "/tmp/conf-wb-1b/probe/big.ts", "/tmp/conf-wb-1b/probe/big.ts", "/tmp/conf-wb-1b/probe/deep.ts"], cwd: "/tmp/conf-wb-1b/probe", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
await Bun.sleep(Number(process.argv[5] ?? 1500));
const sent = performance.now() - t0;
proc.kill(sig as any);
const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
console.log(`signal ${sig} sent after ${Math.round(sent)} ms; ASAN_OPTIONS=${asan ?? "(unset)"}`);
console.log(`exit=${proc.exitCode} signal=${proc.signalCode} total=${Math.round(performance.now() - t0)} ms stdout=${stdout.length} bytes stderr=${stderr.length} bytes`);
console.log(stderr.split("\n").slice(0, 14).map(l => "  | " + l.slice(0, 200)).join("\n"));
