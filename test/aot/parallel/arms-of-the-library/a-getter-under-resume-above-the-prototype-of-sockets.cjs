// Todo: "1" | "0": src/js/node/net.ts keeps Socket.prototype.resume for the short roads where it is compiled, and reads it for that
const { Readable } = require("node:stream");
const real = Readable.prototype.resume;
let gets = 0;
Object.defineProperty(Readable.prototype, "resume", {
  configurable: true,
  get() {
    gets++;
    return real;
  },
  set() {},
});
require("node:net");
console.log(gets);
