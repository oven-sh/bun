// Temporary: times from JavaScript, in this build and in a build of main.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

const repo = join(import.meta.dir, "..");
const [mode, ...rest] = process.argv.slice(2);

if (mode === "child") {
  const read = (...names: string[]) => Buffer.concat(names.map(it => readFileSync(join(repo, it))));
  // Each row has a function of its own, so that the JIT does not mix the call sites.
  const time = (name: string, inputs: unknown[], body: string, budget = 1.2e8) => {
    if (budget > 1e8) Bun.gc(true);
    const loop = `for (let i = 0, j = 0; i < n; i++) { const x = inputs[j]; if (++j === inputs.length) j = 0; keep[0] = ${body}; }`;
    const run = new Function("zlib", "keep", "inputs", "n", loop).bind(null, zlib, [], inputs);
    let [n, least] = [inputs.length, Infinity];
    run(n);
    for (let t = Bun.nanoseconds(); run(n), Bun.nanoseconds() - t < 2e6; t = Bun.nanoseconds()) n *= 2;
    for (let turn = 0, start = Bun.nanoseconds(); turn < 3 || Bun.nanoseconds() - start < budget; turn++) {
      const t = Bun.nanoseconds();
      run(n);
      least = Math.min(least, (Bun.nanoseconds() - t) / n);
    }
    console.log(`${name}\t${least.toFixed(1)}`);
  };
  const texts = {
    md: read(
      "docs/runtime/http/server.mdx",
      "docs/bundler/index.mdx",
      "docs/runtime/sql.mdx",
      "docs/runtime/s3.mdx",
      "docs/runtime/bunfig.mdx",
      "docs/runtime/utils.mdx",
    ),
    rs: read("src/js_parser/lexer.rs", "src/runtime/api/BunObject.rs"),
    json: read("test/cli/install/migration/contoso-test/package-lock.json"),
    exe: readFileSync(rest[0]).subarray(8 << 20, 9 << 20),
  };
  const long = Buffer.concat([texts.json, texts.exe]);
  const several = (all: Buffer, size: number) =>
    Array.from({ length: size < 2000 ? 64 : 1 }, (_, i) => all.subarray(i * 777 + 3, i * 777 + 3 + size));
  const random = (low: number, high: number) => {
    let seed = 1;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8;
    return Array.from({ length: 4096 }, (_, i) => long.subarray(i * 61, i * 61 + low + (next() % (high - low))));
  };
  const lengths = (sizes: number[], ranges: number[][]) => [
    ...sizes.map(it => [`${it}`, several(long, it)] as const),
    ...ranges.map(([low, high]) => [`${low}..${high}`, random(low, high)] as const),
  ];
  const ranges = [
    [1, 32],
    [16, 128],
    [64, 512],
    [512, 4096],
  ];
  const sizes = [3, 7, 12, 16, 24, 40, 64, 100, 128, 200, 256, 300, 350, 400, 500, 640, 800, 1000, 1500, 2500, 4096];
  for (const [name, inputs] of lengths(sizes, ranges))
    for (const it of ["crc32", "adler32"]) time(`hash ${it} ${name}`, inputs, `Bun.hash.${it}(x)`);
  const { ptr } = require("bun:ffi");
  const big = Buffer.concat([long, long, long, long, long, long, long, long]);
  for (const size of [16384, 30000, 33000, 40000, 65536, 100000, 200000, 1000000, 8000000])
    for (const past of [0, 16, 3]) {
      const start = (64 + past - ((Number(ptr(big)) + size) % 64)) % 64;
      for (const it of ["crc32", "adler32"])
        time(`long ${it} ${size}+${past}`, [big.subarray(start, start + size)], `Bun.hash.${it}(x)`);
    }

  // More than the branch predictor can learn.
  const all = (pattern: string) => read(...[...new Bun.Glob(pattern).scanSync(repo)].sort()).subarray(0, 1600000);
  const exe = readFileSync(rest[0]).subarray(8 << 20, 10 << 20);
  const data = {
    md: all("docs/**/*.mdx"),
    rs: all("src/{js_parser,css,install}/*.rs"),
    json: all("test/**/package-lock.json"),
    exe,
    periods: Buffer.concat(
      Array.from({ length: 16000 }, (_, i) =>
        Buffer.alloc(40 + (exe[i] % 128), exe.subarray(i * 31, i * 31 + 1 + (exe[i + 7] % 31))),
      ),
    ),
    lines: Buffer.concat(
      Array.from({ length: 2000 }, (_, i) =>
        Buffer.alloc(400 + exe[i], exe.subarray(i * 97, i * 97 + 33 + (exe[i + 7] % 90))),
      ),
    ),
    line: Buffer.alloc(1000000, "the same line of text, again and again\n"),
    zeros: Buffer.alloc(1000000),
    runs: Buffer.concat(Array.from({ length: 4000 }, (_, i) => Buffer.alloc(200 + exe[i], exe[i * 3]))),
  };
  for (const [kind, all] of Object.entries(data))
    for (const level of [6]) {
      const options = { level, chunkSize: 128 * 1024 };
      const plain = Array.from({ length: Math.min(16, all.length / 60000) | 0 }, (_, i) => [
        all.subarray(5 + i * 60000, 5 + (i + 1) * 60000),
        options,
      ]);
      const packed = (to: "gzipSync" | "deflateSync") =>
        plain.map(([it]) => [zlib[to](it as Buffer, options), options]);
      const name = `${level} many ${kind} ${Bun.hash.crc32(packed("deflateSync")[0][0] as Buffer)}`;
      time(`zlib deflateSync ${name}`, plain, "zlib.deflateSync(x[0], x[1])");
      time(`zlib inflateSync ${name}`, packed("deflateSync"), "zlib.inflateSync(x[0], x[1])");
      time(`zlib gunzipSync ${name}`, packed("gzipSync"), "zlib.gunzipSync(x[0], x[1])");
      time(`zlib Bun.gunzipSync ${name}`, packed("gzipSync"), "Bun.gunzipSync(x[0])");
    }
  for (const size of [300, 1000, 4096, 30000, 200000]) {
    const options = { level: 0, chunkSize: 32 * 1024 };
    const plain = several(long, size).map(it => [it, options] as const);
    const packed = (to: "gzipSync" | "deflateSync") => plain.map(([it]) => [zlib[to](it, options), options]);
    time(`zlib inflateSync 0 ${size} stored 000000`, packed("deflateSync"), "zlib.inflateSync(x[0], x[1])");
    time(`zlib gunzipSync 0 ${size} stored 000000`, packed("gzipSync"), "zlib.gunzipSync(x[0], x[1])");
    time(`zlib Bun.gunzipSync 0 ${size} stored 000000`, packed("gzipSync"), "Bun.gunzipSync(x[0])");
  }
} else {
  console.log(cpus().length, "x", cpus()[0].model);
  for (const it of rest) console.log(Bun.spawnSync([it, "--revision"]).stdout.toString().trim());
  const best = new Map<string, number[]>();
  for (
    let turn = 0, start = Date.now();
    turn < 2 || turn % 2 || ((Date.now() - start) / turn) * (turn + 2) < 245e3;
    turn++
  ) {
    const { stdout, success } = Bun.spawnSync([rest[turn % 2], import.meta.path, "child", rest[0]], {
      stderr: "inherit",
    });
    if (!success) throw new Error(stdout.toString().slice(-300));
    for (const line of stdout.toString().trim().split(/\r?\n/)) {
      const [name, time] = line.split("\t");
      const row = best.get(name) ?? [Infinity, Infinity];
      row[turn % 2] = Math.min(row[turn % 2], Number(time));
      best.set(name, row);
    }
  }
  for (const [name, [a, b]] of best) console.log(`ROW\t${name}\t${a}\t${b}\t${(b / a).toFixed(3)}`);
}
