console.log("required: running begins");
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("required: running.first is read");
    return "first";
  },
});
const { seen } = require("./importer.mjs");
console.log("required: running ends", seen);
