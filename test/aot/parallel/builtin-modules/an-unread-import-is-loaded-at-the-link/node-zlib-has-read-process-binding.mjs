// node:zlib reads process.binding while it loads, at the link: a getter that the body lays over it sees no read when the import is first read and used.
import zlib from "node:zlib";
const reads = [];
const binding = process.binding;
Object.defineProperty(process, "binding", {
  configurable: true,
  get() {
    reads.push("a read of process.binding");
    return binding;
  },
});
console.log(zlib.gzipSync("x").length, reads.join(", ") || "no read");
console.log(typeof process.binding("constants").zlib, reads.join(", "));
