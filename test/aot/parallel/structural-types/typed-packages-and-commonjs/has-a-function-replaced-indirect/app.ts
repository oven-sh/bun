import { callX } from "indirect";
const dep = require("dep");
dep.x = () => "replaced";
console.log(callX(), dep.x());
