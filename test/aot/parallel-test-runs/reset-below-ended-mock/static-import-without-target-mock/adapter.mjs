import { parse } from "./credentials.mjs";
console.log("SAID adapter runs");
export const adapter = () => parse() + 100;
