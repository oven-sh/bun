// realistic: pipeline(source, process.stdout) where the reader goes away (| head -c 10)
const { pipeline, Readable } = require("node:stream");
const fs = require("node:fs");
let n = 0, errors = 0, closes = 0;
process.stdout.on("error", e => { errors++; });
process.stdout.on("close", () => { closes++; });
process.on("uncaughtException", e => fs.writeSync(2, "UNCAUGHT " + (e.code ?? e.message) + "\n"));
pipeline(Readable.from([Buffer.alloc(1 << 20, "a")]), process.stdout, err => {
  fs.writeSync(2, `pipeline callback #${++n}: ${err && err.code}\n`);
});
setTimeout(() => { fs.writeSync(2, `'error' events on process.stdout: ${errors}, 'close': ${closes}, errored: ${process.stdout.errored && process.stdout.errored.code}\n`); }, 300);
