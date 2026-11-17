import { test } from "bun:test";
const steady = require("./steady.cjs");
const gauge = require("./gauge.cjs");
test("b", () => { console.log("b sees", gauge.reading, steady.runs); });
