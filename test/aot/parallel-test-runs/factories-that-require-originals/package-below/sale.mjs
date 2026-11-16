import * as tax from "./tax.ts";
import * as fx from "@made-up/fx";
console.log("sale runs", tax.rate, fx.rate);
export const sold = () => [tax.rate, tax.under?.(), fx.rate].join();
