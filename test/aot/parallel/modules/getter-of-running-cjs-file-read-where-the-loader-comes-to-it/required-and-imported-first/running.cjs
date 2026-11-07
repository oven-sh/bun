console.log("required-and-imported-first: running begins");
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("required-and-imported-first: running.first is read");
    return "first";
  },
});
const { seen } = require("./importer.mjs");
console.log("required-and-imported-first: running ends", seen);
