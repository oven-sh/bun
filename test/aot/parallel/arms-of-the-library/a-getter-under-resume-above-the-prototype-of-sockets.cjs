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
