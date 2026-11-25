const { test } = require("bun:test");
test("c", () => { const r = require("./x.json"); console.log("R c, a CommonJS test file, requires it:", Object.prototype.toString.call(r), Object.keys(r).join(), "default" in r); });
