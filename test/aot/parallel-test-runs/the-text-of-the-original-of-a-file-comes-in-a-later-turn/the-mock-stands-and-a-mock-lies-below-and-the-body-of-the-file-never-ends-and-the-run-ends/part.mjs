import { depth } from "./below.mjs";
console.log("the body of the file begins:", depth);
await new Promise(() => {});
export const opening = "opening " + depth;
