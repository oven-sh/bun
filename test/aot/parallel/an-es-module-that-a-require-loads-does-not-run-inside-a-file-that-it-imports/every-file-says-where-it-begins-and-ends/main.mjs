import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("main:", legacy, "| helper is", typeof helper);
console.log("service begins inside helper:", at("begin helper") < at("begin service") && at("begin service") < at("end helper"));
console.log("service begins inside legacy:", at("begin legacy") < at("begin service") && at("begin service") < at("end legacy"));
console.log("every file ran once:", order.length === 8 && new Set(order).size === 8);
