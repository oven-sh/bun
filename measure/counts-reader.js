// Per 'data' of child.stdout or child.stderr: process.nextTick calls, then() calls, Buffer allocations and views.
// argv: name blocks blockSize. The writer sends a block when the reader has acknowledged the one before (a byte
// appended to ./acks on a later turn, so the next block finds the stream waiting).
const calls = { ticks: 0, thens: 0, bufferAllocs: 0, bufferViews: 0 };
let counting = false;
function count(object, method, as) {
  const original = object[method];
  object[method] = function () { if (counting) calls[as]++; return original.apply(this, arguments); };
}
count(process, "nextTick", "ticks");
count(Promise.prototype, "then", "thens");
for (const method of ["alloc", "allocUnsafe", "allocUnsafeSlow"]) count(Buffer, method, "bufferAllocs");
for (const method of ["subarray", "slice"]) count(Buffer.prototype, method, "bufferViews");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const name = process.argv[2];
const [blocks, blockSize] = process.argv.slice(3).map(Number);
const fd = name === "stdout" ? 1 : 2;
fs.writeFileSync(path.join(__dirname, "acks"), "");
const child = spawn(process.execPath, [path.join(__dirname, "counts-writer.js"), fd, blocks, blockSize].map(String), {
  stdio: ["ignore", fd === 1 ? "pipe" : "inherit", fd === 2 ? "pipe" : "inherit"],
});
let chunks = 0, bytes = 0, acknowledged = 0, shared = 0;
function acknowledge() { counting = false; fs.appendFileSync(path.join(__dirname, "acks"), "."); counting = bytes < blocks * blockSize; }
child[name].on("data", chunk => {
  counting = false;
  chunks++;
  bytes += chunk.length;
  if (!Buffer.isBuffer(chunk) || chunk.byteOffset !== 0 || chunk.buffer.byteLength !== chunk.length) shared++;
  for (; acknowledged < Math.floor(bytes / blockSize); acknowledged++) setImmediate(acknowledge);
  counting = bytes < blocks * blockSize;
});
child.on("close", code => {
  const perChunk = {};
  for (const key in calls) perChunk[key] = +(calls[key] / (chunks - 1)).toFixed(3);
  console.log(JSON.stringify({ code, bytes, chunks, perChunk, chunksOfASharedBuffer: shared }));
});
