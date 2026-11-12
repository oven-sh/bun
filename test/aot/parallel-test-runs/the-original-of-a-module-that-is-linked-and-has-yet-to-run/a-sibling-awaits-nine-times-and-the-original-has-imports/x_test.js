// As ../a-sibling-awaits-seven-times-and-ends-first, two awaits more: the factory goes on first. What the original imports adds no job.
import "./mocks-tax.js";
import "./slow.js";
import { test } from "bun:test";
import * as tax from "./tax.js";
console.log("SAID the test file runs");
test("t", () => console.log("SAID", tax.rate, tax.currency, globalThis.evaluations));
