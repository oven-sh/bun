const { vi } = require("bun:test");
console.log("helper");
if (!globalThis.helper) {
  globalThis.helper = 1;
  vi.doUnmock("./p.mjs");
  delete require.cache[require.resolve("./a.mjs")];
}
