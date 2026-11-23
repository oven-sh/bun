const { test } = require("bun:test");
const gauge = require("./gauge.cjs");
test("a", () => { console.log("a sees", gauge.reading); });
