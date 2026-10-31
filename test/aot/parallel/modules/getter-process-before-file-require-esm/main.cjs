// A getter that the program put on process runs before the CommonJS file that the importer names behind node:process, where require() loads the importer.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
require("./importer.mjs");
console.log("required");
