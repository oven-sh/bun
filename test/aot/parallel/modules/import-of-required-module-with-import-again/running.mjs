import { value } from "./imported.mjs";
console.log("running begins with", value);
require("./imports-back.mjs");
console.log("running ends");
export const ended = true;
