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
  const time = (name: string, inputs: unknown[], body: string) => {
    Bun.gc(true);
    const loop = `for (let i = 0, j = 0; i < n; i++) { const x = inputs[j]; if (++j === inputs.length) j = 0; keep[0] = ${body}; }`;
    const run = new Function("zlib", "keep", "inputs", "n", loop).bind(null, zlib, [], inputs);
    let [n, least] = [inputs.length, Infinity];
    run(n);
    for (let t = Bun.nanoseconds(); run(n), Bun.nanoseconds() - t < 3e6; t = Bun.nanoseconds()) n *= 2;
    for (let turn = 0, start = Bun.nanoseconds(); turn < 3 || Bun.nanoseconds() - start < 1.2e8; turn++) {
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
  const ascii = Buffer.from(texts.rs.map(it => (it < 128 ? it : 63)));
  const long = Buffer.concat([texts.json, texts.exe]);
  const several = (all: Buffer, size: number) =>
    Array.from({ length: size < 2000 ? 64 : 1 }, (_, i) => all.subarray(i * 777 + 3, i * 777 + 3 + size));
  for (const size of [
    3, 7, 12, 16, 24, 40, 64, 100, 127, 128, 200, 300, 400, 700, 1000, 1500, 4096, 16384, 65536, 200000, 1000000,
  ])
    for (const it of ["crc32", "adler32"]) time(`hash ${it} ${size}`, several(long, size), `Bun.hash.${it}(x)`);
  for (const [low, high] of [
    [1, 32],
    [1, 128],
    [64, 512],
    [512, 4096],
  ]) {
    let seed = 1;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8;
    const some = Array.from({ length: 4096 }, (_, i) => long.subarray(i * 61, i * 61 + low + (next() % (high - low))));
    for (const it of ["crc32", "adler32"]) time(`hash ${it} ${low}..${high}`, some, `Bun.hash.${it}(x)`);
  }
  for (const size of [40, 4096, 200000]) time(`zlib crc32 ${size}`, several(long, size), "zlib.crc32(x)");

  const data = {
    ...texts,
    zeros: Buffer.alloc(300000),
    line: Buffer.alloc(300000, "the same line of text, again and again\n"),
    periods: Buffer.concat(
      Array.from({ length: 3000 }, (_, i) => Buffer.alloc(100, texts.exe.subarray(i * 31, i * 31 + 1 + (i % 31)))),
    ),
  };
  for (const [kind, all] of Object.entries(data))
    for (const size of kind === "md" ? [300, 4096, 100000] : [100000])
      for (const [to, from] of [
        ["gzipSync", "gunzipSync"],
        ["deflateSync", "inflateSync"],
      ] as const)
        for (const level of [0, 1, 6]) {
          if (level === 0 && kind !== "md") continue;
          const [plain, options] = [all.subarray(5, 5 + size), { level, chunkSize: 128 * 1024 }];
          const packed = zlib[to](plain, options);
          const name = `${level} ${size} ${kind} ${Bun.hash.crc32(packed)}`;
          time(`zlib ${to} ${name}`, [[plain, options]], `zlib.${to}(x[0], x[1])`);
          time(`zlib ${from} ${name}`, [[packed, options]], `zlib.${from}(x[0], x[1])`);
          if (to === "gzipSync" && level !== 1) time(`zlib Bun.gunzipSync ${name}`, [packed], "Bun.gunzipSync(x)");
        }
  for (const size of [100, 4096, 100000]) {
    const [plain, options] = [texts.md.subarray(0, size), { library: "libdeflate", level: 6 } as const];
    time(`deflate gzip ${size}`, [[plain, options]], "Bun.gzipSync(x[0], x[1])");
    time(`deflate gunzip ${size}`, [[Bun.gzipSync(plain, options), options]], "Bun.gunzipSync(x[0], x[1])");
  }
  for (const [kind, all] of Object.entries(texts))
    for (const size of [2000, 20000]) {
      const options = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } };
      const some = [[all.subarray(1000, 1000 + size), options] as const];
      const hash = Bun.hash.crc32(zlib.brotliCompressSync(...some[0]));
      time(`brotli q11 ${size} ${kind} ${hash}`, some, "zlib.brotliCompressSync(x[0], x[1])");
    }

  for (const size of [40, 63, 64, 100, 300, 1000, 4096, 65536]) {
    const lines = several(ascii, size).map(it => it.toString("latin1"));
    const flat = (it: string) => Buffer.from(it).toString("latin1");
    const kinds = {
      lines,
      "one line": lines.map(it => flat(it.replaceAll("\n", " "))),
      colored: lines.map(it => flat(it.replaceAll("self", "\x1b[31mself\x1b[0m").slice(0, size))),
    };
    for (const [kind, some] of Object.entries(kinds))
      time(`text stringWidth ${kind} ${size}`, some, "Bun.stringWidth(x)");
  }
  for (const size of [300, 4096, 65536])
    for (const it of ["indexOf", "lastIndexOf"])
      for (const needle of ["fn q", "self.lexer.q", "self.lexer.token == Q"])
        time(
          `search ${it} ${needle.length} miss ${size}`,
          several(ascii, size).map(it => [it, Buffer.from(needle)]),
          `x[0].${it}(x[1])`,
        );
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
