import { mock, vi } from "bun:test";
try {
  (globalThis.requiredByThePreload ??= {})[require.resolve("./p/cjs--es-throws/lib.mjs")] = require("./p/cjs--es-throws/lib.mjs");
} catch (error) {
  globalThis.requiredByThePreload[require.resolve("./p/cjs--es-throws/lib.mjs")] = "threw " + error?.name;
}
