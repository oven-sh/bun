import * as it from "./tax.mjs";
import * as fx from "@made-up/fx";
console.log("SAID sale runs", it.rate, fx.rate);
export const sold = () => [it.rate, it.under(), fx.rate].join();
