// does a replaced _write see the marker, and can user code reach the run object through it?
const seen = [];
const orig = process.stdout._write;
process.stdout._write = function (chunk, enc, cb) { seen.push({ len: chunk.length, syms: Object.getOwnPropertySymbols(chunk).map(String) }); return orig.call(this, chunk, enc, cb); };
process.stdout.write("a\n", () => {});
process.stdout.write(Buffer.alloc(1 << 20, "b"), () => {});
process.stdout.write("c\n", () => {});
setImmediate(() => require("fs").writeSync(2, JSON.stringify(seen) + "\n"));
