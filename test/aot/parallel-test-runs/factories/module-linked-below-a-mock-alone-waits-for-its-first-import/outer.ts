import { inner } from "./inner";

console.log("the body of outer.ts runs");
export const outer = "real outer over " + inner;
