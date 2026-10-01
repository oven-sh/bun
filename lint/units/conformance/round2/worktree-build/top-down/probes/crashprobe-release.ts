// The release binary: many operands so that the run lasts long enough for a signal to arrive.
const BIN = process.argv[2];
const sig = process.argv[3] ?? "SIGSEGV";
const env: Record<string, string> = { PATH: process.env.PATH!, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
const operands = Array.from({ length: 2000 }, () => "/tmp/conf-wb-1b/probe/big.ts");
const t0 = performance.now();
const proc = Bun.spawn({ cmd: [BIN, "--lint", ...operands], cwd: "/tmp/conf-wb-1b/probe", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
await Bun.sleep(Number(process.argv[4] ?? 400));
const sent = performance.now() - t0;
const alive = proc.exitCode === null && proc.signalCode === null;
proc.kill(sig as any);
const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
console.log(`signal ${sig} sent after ${Math.round(sent)} ms (alive then: ${alive})`);
console.log(`exit=${proc.exitCode} signal=${proc.signalCode} total=${Math.round(performance.now() - t0)} ms stdout=${stdout.length} bytes stderr=${stderr.length} bytes`);
console.log(stderr.split("\n").slice(0, 16).map(l => "  | " + l.slice(0, 200)).join("\n"));
