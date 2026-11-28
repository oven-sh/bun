const { vi } = require("bun:test");
console.log("helper");
delete require.cache[require.resolve("./a.mjs")];
vi.doMock("./p.mjs", () => ({ v: "M", default: "M", bump() {}, platform: "M" }));
exports.h = 1;
