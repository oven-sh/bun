// As ../a-sibling-awaits-seven-times-and-ends-first, one await more: the sibling ends, the factory goes on, the test file runs.
import "./mocks-tax.js";
import "./slow.js";
import { test } from "bun:test";
import * as tax from "./tax.js";
console.log("SAID the test file runs");
test("t", () => console.log("SAID", tax.rate, tax.currency, globalThis.evaluations));
