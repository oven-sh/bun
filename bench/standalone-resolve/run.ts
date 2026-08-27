// Interleaves runs of several commands and prints the median wall time of each,
// plus the median of any `importMs` the command prints as JSON on stdout.
//
//   bun bench/standalone-resolve/run.ts [--runs=N] name=cmd [name=cmd ...]
//
// A command is split on spaces; environment goes through the caller's env.
let runs = 15;
const cmds: { name: string; argv: string[]; wall: number[]; inner: number[] }[] = [];
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf("=");
  if (eq < 1) throw new Error(`expected name=cmd, got ${JSON.stringify(arg)}`);
  if (arg.startsWith("--runs=")) runs = Number(arg.slice(7));
  else cmds.push({ name: arg.slice(0, eq), argv: arg.slice(eq + 1).split(" "), wall: [], inner: [] });
}
if (!(runs > 0) || cmds.length === 0) throw new Error("usage: run.ts [--runs=N] name=cmd ...");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const { argv } of cmds) Bun.spawnSync({ cmd: argv, stdout: "ignore", stderr: "ignore" }); // warmup
for (let i = 0; i < runs; i++) {
  for (const cmd of cmds) {
    const t0 = performance.now();
    const proc = Bun.spawnSync({ cmd: cmd.argv, stdout: "pipe", stderr: "ignore" });
    cmd.wall.push(performance.now() - t0);
    if (proc.exitCode !== 0) throw new Error(`${cmd.name} exited with ${proc.exitCode}`);
    const line = proc.stdout.toString().trim().split("\n").at(-1) ?? "";
    try {
      const json = JSON.parse(line);
      if (typeof json.importMs === "number") cmd.inner.push(json.importMs);
    } catch {}
  }
}

for (const { name, wall, inner } of cmds) {
  const parts = [`${name.padEnd(12)} wall median ${median(wall).toFixed(1)}ms (min ${Math.min(...wall).toFixed(1)})`];
  if (inner.length) parts.push(`importMs median ${median(inner).toFixed(2)} (min ${Math.min(...inner).toFixed(2)})`);
  console.log(parts.join("  "));
}
