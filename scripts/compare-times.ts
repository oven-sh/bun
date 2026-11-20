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
  void [read, time];
  let state = 1;
  const noise = Buffer.from(
    Uint8Array.from({ length: 1600000 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 8;
    }),
  );
  const C = zlib.constants;
  for (const size of [300000, 1000000, 1500000])
    for (const checksum of [0, 1])
      for (const chunkSize of [16384, 131072, 2 << 20]) {
        const params = { [C.ZSTD_c_compressionLevel]: 1, [C.ZSTD_c_checksumFlag]: checksum };
        const [input, times, keep] = [noise.subarray(5, 5 + size), [] as number[], [] as unknown[]];
        Bun.gc(true);
        for (let i = 0; i < 400; i++) {
          const t = Bun.nanoseconds();
          keep[0] = zlib.zstdCompressSync(input, { params, chunkSize });
          times.push(Bun.nanoseconds() - t);
        }
        const name = `${size} sum${checksum} by${chunkSize}`;
        console.log(`mean ${name}\t${times.reduce((a, b) => a + b) / times.length}`);
        times.sort((a, b) => a - b);
        console.log(`least ${name}\t${times[0]}`);
        console.log(`median ${name}\t${times[200]}`);
      }
} else {
  console.log(cpus().length, "x", cpus()[0].model);
  for (const it of rest) console.log(Bun.spawnSync([it, "--revision"]).stdout.toString().trim());
  const best = new Map<string, number[]>();
  for (
    let turn = 0, start = Date.now();
    turn < 2 || turn % 2 || ((Date.now() - start) / turn) * (turn + 2) < 120e3;
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
