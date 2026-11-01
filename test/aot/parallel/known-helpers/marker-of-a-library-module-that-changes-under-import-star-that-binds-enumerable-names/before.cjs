const os = require("node:os");
globalThis.readsOfMarker = 0;
Object.defineProperty(os, "__esModule", {
  get() {
    return globalThis.readsOfMarker++ > 0;
  },
  configurable: true,
});
Object.defineProperty(os, "EOL", {
  get() {
    return this === os ? "read on the module" : "read on another object";
  },
  enumerable: true,
  configurable: true,
});
