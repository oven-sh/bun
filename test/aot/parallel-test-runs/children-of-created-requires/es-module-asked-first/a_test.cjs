const { test } = require("bun:test");
test("children", () => { globalThis.showsCache = true; require("./piece.cjs"); });
