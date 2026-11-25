import * as it from "./tax.mjs";
import * as fx from "./fx.mjs";
console.log("sale runs", it.rate, fx.rate);
export const sold = () => [it.rate, fx.rate].join();
