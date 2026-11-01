// Awaited calls with a job copy of `bytes` bytes.
// Usage: bun awaited.mjs <kind> <bytes> <concurrency> <rounds> [chains]
// kind: string (fs.promises.writeFile of a non-ASCII string), view (of a view of a resizable
// ArrayBuffer), archive (Bun.Archive.write of a typed array), zstd (Bun.zstdCompress of a view).
// Without "chains": `rounds` times one Promise.all of `concurrency` calls.
// With "chains": `concurrency` chains that each await `rounds` calls one at a time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const kind = process.argv[2];
const bytes = Number(process.argv[3]);
const concurrency = Number(process.argv[4]);
const rounds = Number(process.argv[5]);
const chains = process.argv[6] === "chains";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pool-release-limit-"));
const files = Array.from({ length: concurrency }, (_, i) => path.join(dir, "out" + i));
const view = () => new Uint8Array(new ArrayBuffer(bytes, { maxByteLength: 2 * bytes })).fill(0x61);
const calls = {
  string: (text => file => fs.promises.writeFile(file, text))(Buffer.alloc(bytes - 3, "a").toString("latin1") + "\u4e2d"),
  view: (data => file => fs.promises.writeFile(file, data))(view()),
  archive: (data => file => Bun.Archive.write(file, data))(new Uint8Array(bytes).fill(0x61)),
  zstd: (data => () => Bun.zstdCompress(data, { level: 1 }))(view()),
};
const call = calls[kind];
if (!call) throw new Error("kind: " + Object.keys(calls).join(", "));
if (chains) {
  await Promise.all(
    files.map(async file => {
      for (let round = 0; round < rounds; round++) await call(file);
    }),
  );
} else {
  for (let round = 0; round < rounds; round++) await Promise.all(files.map(call));
}
fs.rmSync(dir, { recursive: true });
