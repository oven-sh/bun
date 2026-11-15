import { seen as inner } from "./duo.mjs";
console.log("SAID body of outer over " + inner);
export const seen = "outer " + inner;
