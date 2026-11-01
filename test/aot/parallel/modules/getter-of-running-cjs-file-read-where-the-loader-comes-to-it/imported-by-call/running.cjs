console.log("imported-by-call: running begins");
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("imported-by-call: running.first is read");
    return "first";
  },
});
const { seen } = require("./importer.mjs");
console.log("imported-by-call: running ends", seen);
