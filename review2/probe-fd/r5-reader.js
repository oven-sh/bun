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
const fd = +process.argv[2];
const [blocks, blockSize] = process.argv.slice(3).map(Number);
fs.writeFileSync(path.join(process.env.MARK_DIR, "acks"), "");
const child = spawn(process.execPath, [path.join(__dirname, "r5-writer.js"), fd, blocks, blockSize].map(String), { stdio: ["ignore", "pipe", "pipe", "pipe"] });
const s = child.stdio[fd];
for (const other of [1, 2, 3]) if (other !== fd) child.stdio[other].resume();
let chunks = 0, bytes = 0, acknowledged = 0, shared = 0;
function acknowledge() { counting = false; fs.appendFileSync(path.join(process.env.MARK_DIR, "acks"), "."); counting = bytes < blocks * blockSize; }
s.on("data", chunk => {
  counting = false;
  chunks++;
  bytes += chunk.length;
  if (!Buffer.isBuffer(chunk) || chunk.byteOffset !== 0 || chunk.buffer.byteLength !== chunk.length) shared++;
  for (; acknowledged < Math.floor(bytes / blockSize); acknowledged++) setImmediate(acknowledge);
  counting = bytes < blocks * blockSize;
});
let code;
child.on("close", c => { code = c; });
process.on("exit", () => {
  const perChunk = {};
  for (const key in calls) perChunk[key] = +(calls[key] / (chunks - 1)).toFixed(2);
  console.log(JSON.stringify({ code, bytes, chunks, perChunk, chunksOfASharedBuffer: shared }));
});
