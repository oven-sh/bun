import { callX } from "reexport";
const dep = require("dep");
dep.y = 3;
console.log(callX(), dep.y);
