// Builds the generated pages with two bun binaries, three ways: standalone
// HTML with linked source maps, an ordinary multi-page build, and the same
// with --splitting. Runs are interleaved across the binaries so drift hits
// them equally. Prints the median wall time and, on Linux, the median count of
// user-mode instructions (pin to one core for a stable count:
// `taskset -c 0 bun run.ts ...`). Fails if the two binaries write different bytes.
// Usage: bun run.ts <bun-before> <bun-after> <appdir> [runs]
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { openInstructionCounter } from "../../test/aot/analysis-scaling/measure-here.ts";

const [before, after, appdirArg, runsStr = "9"] = process.argv.slice(2);
const runs = +runsStr;
if (!before || !after || !appdirArg || !(runs > 0)) {
  console.error("usage: bun run.ts <bun-before> <bun-after> <appdir> [runs]");
  process.exit(1);
}
const appdir = resolve(appdirArg);
const binaries = { before: resolve(before), after: resolve(after) };
const entries = readdirSync(join(appdir, "pages"))
  .filter(file => file.endsWith(".html"))
  .sort()
  .map(file => `pages/${file}`);

const variants: [name: string, args: string[]][] = [
  ["standalone-linked", ["--compile", "--target=browser", "--sourcemap=linked"]],
  ["multi-page", []],
  ["multi-page-splitting", ["--splitting"]],
];

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function treeHash(dir: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of [...new Bun.Glob("**/*").scanSync({ cwd: dir })].sort()) {
    hasher.update(file);
    hasher.update(readFileSync(join(dir, file)));
  }
  return hasher.digest("hex");
}

async function build(bun: string, args: string[]) {
  // The shell waits for a line before it becomes the build, so the counter is open first.
  await using child = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', bun, "build", ...args],
    cwd: appdir,
    env: { ...process.env, NO_COLOR: "1" },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  const readInstructions = process.platform === "linux" ? openInstructionCounter(child.pid) : undefined;
  const start = performance.now();
  child.stdin.write("\n");
  child.stdin.end();
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const wall = performance.now() - start;
  if (exitCode !== 0) {
    console.error("build failed:", bun, args.join(" "), "\n", stderr);
    process.exit(1);
  }
  return { wall, instructions: readInstructions?.() };
}

for (const [variant, args] of variants) {
  const wall = { before: [] as number[], after: [] as number[] };
  const instructions = { before: [] as number[], after: [] as number[] };
  const hashes = new Set<string>();
  for (let i = 0; i < runs; i++) {
    for (const side of ["before", "after"] as const) {
      const outdir = join(appdir, "out", side);
      rmSync(outdir, { recursive: true, force: true });
      const result = await build(binaries[side], [...args, "--outdir", outdir, ...entries]);
      wall[side].push(result.wall);
      if (result.instructions !== undefined) instructions[side].push(result.instructions);
      if (i === 0) hashes.add(treeHash(outdir));
    }
  }
  if (hashes.size !== 1) {
    console.error(variant, "the two binaries wrote different output");
    process.exit(1);
  }
  const counted = instructions.before.length > 0 && instructions.after.length > 0;
  console.log(
    JSON.stringify({
      variant,
      pages: entries.length,
      wall_ms_before: Math.round(median(wall.before)),
      wall_ms_after: Math.round(median(wall.after)),
      instructions_before: counted ? median(instructions.before) : undefined,
      instructions_after: counted ? median(instructions.after) : undefined,
    }),
  );
}
