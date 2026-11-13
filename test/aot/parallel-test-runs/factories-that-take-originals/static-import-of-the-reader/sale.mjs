import { rate, under } from "./tax.mjs";
import * as fx from "./fx.mjs";
console.log("sale runs", rate, fx.rate);
export const sold = () => [rate, under(), fx.rate].join();
