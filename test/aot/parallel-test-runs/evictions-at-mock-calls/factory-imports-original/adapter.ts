import { parse } from "./credentials";
console.log("adapter runs");
export const adapter = () => parse() + 100;
