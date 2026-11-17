(globalThis as any).runsOfTax = ((globalThis as any).runsOfTax ?? 0) + 1;
console.log("tax runs");
import "./lays-the-mock";
export const rate = 0.2;
export let currency = "EUR";
