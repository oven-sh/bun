// A getter that the program put on process runs before the CommonJS file that the importer names behind node:process, where the importer has a top-level await.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs").then(() => console.log("imported"));
