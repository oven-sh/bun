// Realistic: a CLI that writes a big result and ends stdout; the reader is `head -c 1`.
const mode = process.argv[2];
const fs = require("node:fs");
let n = 0;
const h = e => { n++; fs.writeSync(2, "handled error #" + n + ": " + e.code + "\n"); };
if (mode.startsWith("once")) process.stdout.once("error", h); else process.stdout.on("error", h);
process.stdout.write(Buffer.alloc((1 << 20) + 1, "a"));
if (mode.endsWith("end")) process.stdout.end();
else if (mode.endsWith("endchunk")) process.stdout.end("bye\n");
setTimeout(() => { fs.writeSync(2, "done, errors=" + n + "\n"); }, 500);
