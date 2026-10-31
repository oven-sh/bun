Object.defineProperty(process, "custom", {
  get() {
    postMessage("in the getter");
    for (;;);
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs");
