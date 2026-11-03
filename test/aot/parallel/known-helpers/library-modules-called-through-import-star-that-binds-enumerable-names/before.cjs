const path = require("node:path");
delete path.extname;
Object.defineProperty(path, "dirname", { value: path.dirname, enumerable: false, writable: true, configurable: true });
globalThis.readsOfSep = 0;
Object.defineProperty(path, "sep", {
  get() {
    globalThis.readsOfSep++;
    return "/";
  },
  enumerable: true,
  configurable: true,
});
require("node:os").__esModule = true;
globalThis.readsOfMarker = 0;
Object.defineProperty(require("node:util"), "__esModule", {
  get() {
    globalThis.readsOfMarker++;
    return false;
  },
  configurable: true,
});
