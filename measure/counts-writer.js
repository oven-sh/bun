const fs = require("node:fs");
const path = require("node:path");
const [fd, blocks, blockSize] = process.argv.slice(2).map(Number);
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 60_000;
const block = Buffer.alloc(blockSize, 97);
for (let k = 1; k <= blocks; k++) {
  for (let written = 0; written < blockSize; ) written += fs.writeSync(fd, block, written);
  while (fs.statSync(path.join(__dirname, "acks")).size < k) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the acknowledgement of block " + k);
    Atomics.wait(nap, 0, 0, 1);
  }
}
