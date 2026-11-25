const { test } = require("bun:test");
const gauge = require("./gauge.cjs");
test("b", () => { console.log("b sees", gauge.reading); });
