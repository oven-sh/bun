import { callX } from "main";
const dep = require("dep");
dep.x = () => "replaced";
console.log(callX(), dep.x());
