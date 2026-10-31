// A getter that the program put on process does not run inside the import() call of the CommonJS file that the importer names behind node:process.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs").then(() => console.log("imported"));
