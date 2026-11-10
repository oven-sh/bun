import * as lib from "./lib.mjs";
export const a = "reader";
export const seen = () => (typeof lib.seen === "function" ? lib.seen() : "no seen " + lib.a);
export const n = 0;
