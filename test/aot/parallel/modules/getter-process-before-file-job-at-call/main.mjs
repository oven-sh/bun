// A getter that the program put on process runs before the CommonJS file that the importer names behind node:process, where one job of the program waits when import() is called and none when the loader asks the importer for its requests.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs").then(() => console.log("imported"));
Promise.resolve().then(() => console.log("a job"));
