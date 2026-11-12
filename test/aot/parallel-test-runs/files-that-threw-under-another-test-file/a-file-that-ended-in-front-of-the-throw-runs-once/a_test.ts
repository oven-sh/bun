import { test } from "bun:test";
const steady = require("./steady.cjs");
const gauge = require("./gauge.cjs");
test("a", () => { console.log("a sees", gauge.reading, steady.runs); });
