import { a } from "./a.mjs";
console.log("b runs");
let calls = 0;
export const b = () => "b" + ++calls;
export const both = () => a();
