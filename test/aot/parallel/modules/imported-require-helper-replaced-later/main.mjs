// The exporting file stores another function to the variable that held its `require`, so a call through the import is an ordinary call.
import { __require, replace } from "./chunk.mjs";
replace();
console.log(__require("./inside.cjs"));
