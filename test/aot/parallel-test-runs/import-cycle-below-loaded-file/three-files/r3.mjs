import { one } from "./r1.mjs";
import { leaf } from "./leaf.mjs";
console.log("SAID r3 runs");
export const third = () => "3" + one() + leaf();
