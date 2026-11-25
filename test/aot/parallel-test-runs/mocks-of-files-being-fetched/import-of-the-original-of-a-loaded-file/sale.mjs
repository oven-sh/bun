import { rate } from "./tax.mjs";
import { rate as fx } from "./fx.mjs";
console.log("sale runs", rate, fx);
export const sold = () => [rate, fx].join();
