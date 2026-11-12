const { test } = require("bun:test");
test("u", () => { const it = require("./lib.cjs"); console.log("SAID next", it.a, it.n, globalThis.runsOfLib); });
