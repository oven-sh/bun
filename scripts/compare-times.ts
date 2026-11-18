// Temporary: times from JavaScript, in this build and in a build of main.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

const repo = join(import.meta.dir, "..");
const [mode, ...rest] = process.argv.slice(2);

if (mode === "child") {
  const k = zlib.constants;
  const best = (f: () => unknown) => {
    for (const warm = Bun.nanoseconds(); Bun.nanoseconds() - warm < 5e6;) f();
    const once = Bun.nanoseconds() - 1;
    f();
    const n = Math.max(1, Math.floor(2e7 / (Bun.nanoseconds() - once)));
    let least = Infinity;
    for (let turn = 0, start = Bun.nanoseconds(); turn < 3 || Bun.nanoseconds() - start < 1.4e8; turn++) {
      const t = Bun.nanoseconds();
      for (let i = 0; i < n; i++) f();
      least = Math.min(least, (Bun.nanoseconds() - t) / n);
    }
    return (least / 1e3).toFixed(2);
  };
  const files = {
    md: "docs/runtime/http/server.mdx docs/bundler/index.mdx docs/runtime/sql.mdx docs/runtime/s3.mdx docs/runtime/bunfig.mdx docs/runtime/utils.mdx",
    rs: "src/js_parser/lexer.rs src/runtime/api/BunObject.rs",
    json: "test/cli/install/migration/contoso-test/package-lock.json",
    exe: rest[0],
  };
  for (const [kind, names] of Object.entries(files)) {
    const all =
      kind === "exe"
        ? readFileSync(names).subarray(8 << 20, 9 << 20)
        : Buffer.concat(names.split(" ").map(it => readFileSync(join(repo, it))));
    for (const size of [300, 2000, 20000, 200000]) {
      const data = all.subarray(1000, 1000 + size);
      for (const quality of [0, 1, 4, 5, 7, 9, 10, 11]) {
        const options = { params: { [k.BROTLI_PARAM_QUALITY]: quality } };
        const hash = Bun.hash.crc32(zlib.brotliCompressSync(data, options)).toString(16);
        console.log(
          `q${quality} ${data.length} ${kind} ${hash}\t${best(() => zlib.brotliCompressSync(data, options))}`,
        );
      }
      const packed = zlib.brotliCompressSync(data);
      console.log(`decode ${data.length} ${kind}\t${best(() => zlib.brotliDecompressSync(packed))}`);
    }
  }
} else {
  const builds = rest;
  console.log(cpus().length, "x", cpus()[0].model);
  for (const it of builds) console.log(Bun.spawnSync([it, "--revision"]).stdout.toString().trim());
  for (const script of [[import.meta.path, "child", builds[0]]]) {
    const best = new Map<string, number[]>();
    for (let turn = 0; turn < 4; turn++) {
      const { stdout, success } = Bun.spawnSync([builds[turn % 2], ...script], { stderr: "inherit" });
      if (!success) process.exit(1);
      for (const line of stdout.toString().trim().split(/\r?\n/)) {
        const [name, time] = line.split("\t");
        const row = best.get(name) ?? [Infinity, Infinity];
        row[turn % 2] = Math.min(row[turn % 2], Number(time));
        best.set(name, row);
      }
    }
    for (const [name, [a, b]] of best) console.log(`ROW\t${name}\t${a}\t${b}\t${(b / a).toFixed(3)}`);
  }
}
