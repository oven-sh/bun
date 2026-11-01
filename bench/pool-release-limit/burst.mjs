// Peak RSS of pending fs.promises.writeFile calls with a job copy of `bytes` bytes.
// Usage: BUN_X_POOL_RELEASE_MIN=<bytes> bun burst.mjs <string|view> <count> <bytes>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [kind, count, bytes] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pool-release-limit-"));
const files = Array.from({ length: count }, (_, i) => path.join(dir, "out" + i));
const data =
  kind === "view"
    ? new Uint8Array(new ArrayBuffer(bytes, { maxByteLength: 2 * bytes })).fill(0x61)
    : Buffer.alloc(bytes - 3, "a").toString("latin1") + "\u4e2d";
await Promise.all(files.map(file => fs.promises.writeFile(file, data)));
const peak = Math.round(Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) / 1024);
fs.rmSync(dir, { recursive: true });
console.log(`${count} pending writes of a ${kind} with a copy of ${bytes} bytes: peak RSS ${peak} MB`);
