globalThis.evaluations = (globalThis.evaluations ?? 0) + 1; console.log("SAID tax begins", globalThis.evaluations);
import "./mocks-tax.js";
export const rate = 0.2;
export let currency = "EUR";
console.log("SAID tax ends");
