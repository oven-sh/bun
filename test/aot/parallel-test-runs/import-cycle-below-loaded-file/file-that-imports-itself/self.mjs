import { one as own } from "./self.mjs";
import { leaf } from "./leaf.mjs";
console.log("SAID self runs");
export const one = () => "one ";
export const first = () => own() + leaf();
