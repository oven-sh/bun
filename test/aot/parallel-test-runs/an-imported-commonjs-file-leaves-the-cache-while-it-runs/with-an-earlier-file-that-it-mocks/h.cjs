const { vi } = require("bun:test");
globalThis.h = (globalThis.h ?? 0) + 1;
console.log("h");
if (globalThis.h === 1) {
  vi.doMock("./early.cjs", () => ({ v: "M" }));
}
Object.assign(exports, { v: "h" + globalThis.h });
