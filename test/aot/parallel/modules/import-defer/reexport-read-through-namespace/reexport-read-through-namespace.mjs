import defer * as a from "./a.mjs";
import * as helper from "./helper.mjs";
const name = ["handed", "On"].join("");
console.log("main begins", helper.handedOn === a, helper[name] === a, Object.prototype.toString.call(helper[name]));
console.log(helper[name].value);
