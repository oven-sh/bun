import { value } from "./imported.mjs";
console.log("inner begins with", value);
require("./imports-back.mjs");
console.log("inner ends");
export const ended = "inner";
