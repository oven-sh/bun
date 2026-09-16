// Builds the generated app four ways (splitting with and without the default
// require() splitting, source and bytecode) with the given bun binary, then measures startup wall time, the
// in-process time to the end of the entry module, and the physical footprint.
// Runs are interleaved across variants so drift hits them equally.
// Usage: bun run.ts <bun-binary> <appdir> [runs]
import { statSync } from "node:fs";
import { join } from "node:path";

const [bun, appdir, runsStr = "15"] = process.argv.slice(2);
const runs = +runsStr;
if (!bun || !appdir || !(runs > 0)) {
  console.error("usage: bun run.ts <bun-binary> <appdir> [runs]");
  process.exit(1);
}

const variants: [name: string, args: string[]][] = [
  ["source", ["--no-split-require"]],
  ["source-split-require", []],
  ["bytecode", ["--bytecode", "--no-split-require"]],
  ["bytecode-split-require", ["--bytecode"]],
];

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

const built: { name: string; outfile: string; build_ms: number; wall: number[]; inproc: number[]; footprint: number[] }[] =
  [];
for (const [name, args] of variants) {
  const outfile = join(appdir, "out", name);
  const t0 = performance.now();
  const build = Bun.spawnSync({
    cmd: [
      bun,
      "build",
      "--compile",
      "--splitting",
      "--target=bun",
      "--format=esm",
      "--minify",
      ...args,
      `--outfile=${outfile}`,
      join(appdir, "entry.ts"),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) {
    console.error(name, "build failed:\n", build.stderr.toString());
    process.exit(1);
  }
  built.push({ name, outfile, build_ms: performance.now() - t0, wall: [], inproc: [], footprint: [] });
}

let outLen: number | undefined;
for (let i = 0; i < runs; i++) {
  for (const v of built) {
    const s = performance.now();
    const p = Bun.spawnSync({
      cmd: [v.outfile],
      env: { ...process.env, BENCH_REPORT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    v.wall.push(performance.now() - s);
    if (p.exitCode !== 0) {
      console.error(v.name, "run failed:\n", p.stderr.toString());
      process.exit(1);
    }
    const r = JSON.parse(p.stdout.toString());
    v.inproc.push(r.ms_since_start);
    v.footprint.push(r.footprint_mb);
    if (outLen !== undefined && outLen !== r.out_len) {
      console.error(v.name, "output differs from the other variants");
      process.exit(1);
    }
    outLen = r.out_len;
  }
}

for (const v of built) {
  console.log(
    JSON.stringify({
      variant: v.name,
      build_ms: Math.round(v.build_ms),
      exe_bytes: statSync(v.outfile).size,
      wall_ms_median: +median(v.wall).toFixed(1),
      entry_done_ms_median: +median(v.inproc).toFixed(1),
      footprint_mb_median: median(v.footprint),
    }),
  );
}
