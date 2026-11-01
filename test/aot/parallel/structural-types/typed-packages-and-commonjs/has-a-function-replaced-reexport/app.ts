import { callX } from "reexport";
const dep = require("dep");
dep.x = () => "replaced";
console.log(callX(), dep.x());
