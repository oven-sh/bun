// A job that a getter on process queues while node:process is generated runs in a turn of its own, not inside the import() call of a CommonJS file one level below.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    Promise.resolve().then(() => console.log("the job of the getter"));
    return 1;
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs").then(() => console.log("imported"));
