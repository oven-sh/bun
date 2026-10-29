import { begin } from "./async-function.mjs";
await begin();
console.log("imported-async-function ran");
export const name = "imported-async-function";
