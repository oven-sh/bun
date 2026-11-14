const { test } = require("bun:test"); test("the first", () => console.log("SAID a", globalThis.before, globalThis.runs));
