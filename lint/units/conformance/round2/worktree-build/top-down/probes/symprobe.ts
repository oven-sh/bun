const BIN = "/workspace/wt/conformance/build/debug/bun-debug";
const env = { PATH: process.env.PATH!, HOME: "/root", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
const cases: [string, string, string[]][] = [
  ["cwd through a symlink, relative operand", "/tmp/conf-wb-1b/link", ["bad.ts"]],
  ["cwd through a symlink, absolute operand through the link", "/tmp/conf-wb-1b/link", ["/tmp/conf-wb-1b/link/bad.ts"]],
  ["cwd through a symlink, absolute operand physical", "/tmp/conf-wb-1b/link", ["/tmp/conf-wb-1b/probe/bad.ts"]],
  ["physical cwd, operand is a symlink to bad.ts", "/tmp/conf-wb-1b/probe", ["lnk.ts"]],
  ["physical cwd, symlink and its target", "/tmp/conf-wb-1b/probe", ["lnk.ts", "bad.ts"]],
  ["operand with ./ and ..", "/tmp/conf-wb-1b/probe", ["./sub/../bad.ts"]],
  ["upper-case extension", "/tmp/conf-wb-1b/probe", ["BAD.TS"]],
];
for (const [name, cwd, args] of cases) {
  const proc = Bun.spawn({ cmd: [BIN, "--lint", ...args], cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(`## ${name}\n   cwd=${cwd} args=${JSON.stringify(args)}\n   exit=${proc.exitCode} signal=${proc.signalCode}\n   stdout=${JSON.stringify(stdout)}\n   stderr=${JSON.stringify(stderr)}`);
}
