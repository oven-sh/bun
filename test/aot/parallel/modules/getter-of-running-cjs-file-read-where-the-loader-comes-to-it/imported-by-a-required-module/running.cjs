console.log("imported-by-a-required-module: running begins");
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("imported-by-a-required-module: running.first is read");
    return "first";
  },
});
const { seen } = require("./importer.mjs");
console.log("imported-by-a-required-module: running ends", seen);
