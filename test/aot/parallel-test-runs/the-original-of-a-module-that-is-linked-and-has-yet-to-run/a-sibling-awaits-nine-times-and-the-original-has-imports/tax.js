globalThis.evaluations = (globalThis.evaluations ?? 0) + 1; console.log("SAID tax begins", globalThis.evaluations);
import "./mocks-tax.js";
import { one } from "./one.js";
import { two } from "./two.js";
export const rate = 0.2 + one - two;
export let currency = "EUR";
console.log("SAID tax ends");
