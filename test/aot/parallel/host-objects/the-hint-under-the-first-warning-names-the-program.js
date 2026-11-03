// The hint takes the last part of process.argv0 as node:path does. The child is this program again: it prints one warning.
const values = ["node", "/usr/bin/node", "/usr/bin/node/", "a/b//", "//", "/", "", "C:\\x\\y.exe", "C:", "c:a", "a\\b", "a\\b\\", "..", ".", "x y", null, 0];
if (process.env.ARGV0_OF_CHILD === undefined) {
  for (const value of values) {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [process.execPath, process.argv[1], "child"],
      env: { ...process.env, ARGV0_OF_CHILD: JSON.stringify(value) },
      stderr: "pipe",
    });
    // An executable may be asked to say more about itself there.
    const lines = stderr.toString().split("\n").filter(line => line.startsWith("("));
    console.log(JSON.stringify(value), JSON.stringify(lines), exitCode);
  }
} else {
  Object.defineProperty(process, "pid", { value: 1 });
  process.argv0 = JSON.parse(process.env.ARGV0_OF_CHILD);
  process.emitWarning("a warning");
}
