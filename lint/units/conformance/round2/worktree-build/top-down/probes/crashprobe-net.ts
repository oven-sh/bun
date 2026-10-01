// Does a crashing lint child start curl? PATH holds a stand-in for curl that only logs: nothing reaches the network.
const BIN = process.argv[2];
const extra = Object.fromEntries(process.argv.slice(3).map(kv => kv.split("=") as [string, string]));
const env: Record<string, string> = { PATH: "/tmp/conf-wb-1b/fakebin", HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", ...extra };
const operands = Array.from({ length: 2000 }, () => "/tmp/conf-wb-1b/probe/big.ts");
const proc = Bun.spawn({ cmd: [BIN, "--lint", ...operands], cwd: "/tmp/conf-wb-1b/probe", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
await Bun.sleep(500);
proc.kill("SIGSEGV");
const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
await Bun.sleep(1500);
const log = await Bun.file("/tmp/conf-wb-1b/fakecurl.log").text().catch(() => "");
console.log(`extra env ${JSON.stringify(extra)}: exit=${proc.exitCode} signal=${proc.signalCode}; curl stand-in log: ${JSON.stringify(log.slice(0, 200))}`);
console.log(stderr.split("\n").slice(9, 22).map(l => "  | " + l.slice(0, 160)).join("\n"));
