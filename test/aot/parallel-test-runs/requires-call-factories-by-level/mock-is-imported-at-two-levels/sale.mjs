import * as tax from "./tax.mjs";
import * as fx from "./fx.mjs";
console.log("sale runs", tax.rate, fx.rate);
export const sold = () => [tax.rate, tax.under?.(), fx.rate].join();
