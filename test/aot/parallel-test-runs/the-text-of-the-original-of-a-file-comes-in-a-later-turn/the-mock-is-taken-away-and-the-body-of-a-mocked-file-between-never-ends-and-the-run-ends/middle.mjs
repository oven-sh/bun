import { depth } from "./below.mjs";
console.log("the file between runs:", depth);
await new Promise(() => {});
export const middle = "between " + depth;
