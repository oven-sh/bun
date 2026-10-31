import { value } from "./imported.mjs";
console.log("outer begins with", value);
require("./inner.mjs");
console.log("outer ends");
export const ended = "outer";
