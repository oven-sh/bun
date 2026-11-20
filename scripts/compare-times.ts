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
  const all = (pattern: string) => read(...[...new Bun.Glob(pattern).scanSync(repo)].sort()).subarray(0, 1600000);
  let state = 1;
  const below = (limit: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 8) % limit;
  };
  const made = (byte: () => number) => Buffer.from(Uint8Array.from({ length: 1600000 }, byte));
  const data = {
    md: all("docs/**/*.mdx"),
    rs: all("src/{js_parser,css,install}/*.rs"),
    json: all("test/**/package-lock.json"),
    exe: readFileSync(rest[0]).subarray(8 << 20, 10 << 20),
    skewed: made(() => below(1 + below(256))),
    ascii: made(() => 32 + below(1 + below(95))),
    oneBin: made(() => 64 + below(1 + below(64))),
    and: made(() => below(256) & below(256)),
    noise: made(() => below(256)),
  };
  const pieces = (all: Buffer, size: number) =>
    Array.from({ length: Math.min(64, (all.length - 5) / size, Math.max(1, 5e5 / size)) | 0 }, (_, i) =>
      all.subarray(5 + i * size, 5 + (i + 1) * size),
    );
  for (const [kind, all] of Object.entries(data))
    for (const size of [100, 1000, 4200, 9000, 30000, 131072, 1000000])
      for (const level of size === 30000 && kind.length < 5 ? [1, 3, 7] : [1]) {
        const plain = pieces(all, size).map(it => [it, { level }] as const);
        const packed = plain.map(([it, options]) => Bun.zstdCompressSync(it, options));
        const name = `${kind} ${size} ${level} ${Bun.hash.crc32(Buffer.concat(packed))}`;
        time(`compress ${name}`, plain, "Bun.zstdCompressSync(x[0], x[1])", 5e7);
        if (kind.length < 5 || kind === "skewed") time(`decompress ${name}`, packed, "Bun.zstdDecompressSync(x)", 5e7);
      }
  for (const kind of ["skewed", "ascii", "and", "json"] as const)
    for (const size of [5000, 6000, 7000, 8000, 8500, 9001, 10000, 12000, 16000, 20000]) {
      const plain = pieces(data[kind], size).map(it => [it, { level: 1 }] as const);
      time(`sizes ${kind} ${size}`, plain, "Bun.zstdCompressSync(x[0], x[1])", 5e7);
    }
  for (const size of [8, 32, 64, 300, 4096, 100000])
    time(`hash xxHash64 ${size}`, pieces(data.md, size), "Bun.hash.xxHash64(x)", 5e7);
  const C = zlib.constants;
  for (const [what, params] of Object.entries({
    checksum: { [C.ZSTD_c_compressionLevel]: 1, [C.ZSTD_c_checksumFlag]: 1 },
    long: { [C.ZSTD_c_compressionLevel]: 1, [C.ZSTD_c_enableLongDistanceMatching]: 1 },
  }))
    for (const kind of ["md", "exe", "noise"] as const)
      for (const size of [300, 30000, 1000000]) {
        const options = { params, chunkSize: 128 * 1024 };
        const plain = pieces(data[kind], size).map(it => [it, options] as const);
        const packed = plain.map(([it]) => [zlib.zstdCompressSync(it, options), { chunkSize: 128 * 1024 }]);
        const name = `${what} ${kind} ${size} ${Bun.hash.crc32(packed[0][0] as Buffer)}`;
        time(`compress ${name}`, plain, "zlib.zstdCompressSync(x[0], x[1])", 5e7);
        if (what === "checksum") time(`decompress ${name}`, packed, "zlib.zstdDecompressSync(x[0], x[1])", 5e7);
      }

  const testing = require("bun:internal-for-testing");
  const nanoseconds = (run: () => void, n: number) => {
    let least = Infinity;
    for (let turn = 0; turn < 20; turn++) {
      const t = Bun.nanoseconds();
      for (let i = 0; i < n; i++) run();
      least = Math.min(least, (Bun.nanoseconds() - t) / n);
    }
    return least;
  };
  const whole = readFileSync(require.resolve("typescript", { paths: [join(repo, "test")] }));
  const js = whole.subarray(whole.length >> 1);
  if (process.arch !== "x64") {
  } else if (testing.highwayStringsForTesting) {
    const old = testing.highwayStringsForTesting;
    const room = new Uint8Array(24 + 512 + (1 << 18));
    new Uint16Array(room.buffer, 24, 256).forEach((_, symbol, codes) => (codes[symbol] = 3 + (symbol % 7)));
    const [counts, nothing] = [new Uint8Array(1024), new Uint8Array()];
    const call = nanoseconds(() => old("zstdIsQuicker", nothing, 0), 2000);
    if (old("zstdCountBytes", nothing, counts))
      for (const [name, text] of [
        ["text", js],
        ["any bytes", data.noise],
      ] as const)
        for (const n of [1024, 4159, 32768, 131072]) {
          const some = text.subarray(0, n);
          const times = Math.ceil(5e5 / n);
          const count = nanoseconds(() => old("zstdCountBytes", some, counts), times) - call;
          const write = nanoseconds(() => old("zstdWriteCodes", some, room), times) - call;
          console.log(`zstd::count_bytes ${n}, ${name}\t${count.toFixed(1)}`);
          console.log(`zstd::write_codes ${n}, ${name}\t${write.toFixed(1)}`);
        }
  } else {
    const path = require.resolve("typescript", { paths: [join(repo, "test")] });
    const { stdout } = Bun.spawnSync([
      process.execPath,
      "test",
      "--run-simd-tests",
      "bench",
      path,
      path,
      path,
      "zstd::",
    ]);
    console.log(stdout.toString().trim().split(/\r?\n/).slice(1).join("\n"));
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
      env: { ...process.env, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
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
