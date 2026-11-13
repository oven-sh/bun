// Port of "per chunk the stream queues one tick, and makes no promise and no Buffer but the chunk". argv: fd|std blocks blockSize
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
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const mode = process.argv[2];
const [blocks, blockSize] = process.argv.slice(3).map(Number);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perchunk-"));
fs.writeFileSync(path.join(dir, "acks"), "");
fs.writeFileSync(path.join(dir, "writer.js"), `
  const fs = require("node:fs"); const path = require("node:path");
  const [fd, blocks, blockSize] = process.argv.slice(2).map(Number);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 15_000;
  const block = Buffer.alloc(blockSize, 97);
  for (let k = 1; k <= blocks; k++) {
    for (let written = 0; written < blockSize; ) written += fs.writeSync(fd, block, written);
    while (fs.statSync(path.join(__dirname, "acks")).size < k) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the acknowledgement of block " + k);
      Atomics.wait(nap, 0, 0, 1);
    }
  }
`);
const args = [path.join(dir, "writer.js"), "1", String(blocks), String(blockSize)];
const child = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, args)
  : require("node:child_process").spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
let chunks = 0, bytes = 0, acknowledged = 0, shared = 0;
function acknowledge() { counting = false; fs.appendFileSync(path.join(dir, "acks"), "."); counting = bytes < blocks * blockSize; }
child.stdout.on("data", chunk => {
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
  fs.rmSync(dir, { recursive: true, force: true });
});
