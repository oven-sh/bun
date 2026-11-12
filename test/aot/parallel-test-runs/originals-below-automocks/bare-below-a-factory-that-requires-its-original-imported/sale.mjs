import * as tax from "./tax.mjs";
import * as fx from "./fx.mjs";
console.log("sale runs", tax.name, fx.rate);
export const sold = () => [tax.name, tax.rate2(), fx.rate].join();
