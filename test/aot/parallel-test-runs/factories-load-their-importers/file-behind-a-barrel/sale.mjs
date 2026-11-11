import * as it from "./barrel.mjs";
import * as fx from "./fx.mjs";
console.log("sale runs", it.rate, fx.rate);
export const sold = () => [it.rate, it.under(), fx.rate].join();
