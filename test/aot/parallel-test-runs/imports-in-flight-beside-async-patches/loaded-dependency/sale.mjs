import * as fx from "./fx.mjs";
import * as it from "./b1.mjs";
console.log("SAID sale runs", it.rate, fx.rate);
export const sold = () => [it.rate, it.under(), fx.rate].join();
