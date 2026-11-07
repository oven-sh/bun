import { callX } from "names";
const dep = require("dep");
dep.x = () => "replaced";
console.log(callX(), dep.x());
