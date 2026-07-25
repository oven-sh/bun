// Hardcoded module "node:stream" / "readable-stream"
const exports = require("internal/stream");

$debug("node:stream loaded");

Object.defineProperty(exports, "eos", {
  __proto__: null,
  enumerable: true,
  configurable: true,
  get() {
    const value = exports.finished;
    Reflect.defineProperty(exports, "eos", { value, writable: true, enumerable: true, configurable: true });
    return value;
  },
  set(value) {
    Reflect.defineProperty(exports, "eos", { value, writable: true, enumerable: true, configurable: true });
  },
});

export default exports;
