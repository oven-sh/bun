import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
import * as other from "./second.cjs";
console.log("main:", legacy, "| helper is", typeof helper);
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("second begins inside helper:", at("begin helper") < at("begin second") && at("begin second") < at("end helper"));
console.log("every file ran once:", order.length === 10 && new Set(order).size === 10);
