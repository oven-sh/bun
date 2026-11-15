import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
console.log("main:", legacy, "| helper is", typeof helper);
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("helper begins inside second:", at("begin second") < at("begin helper") && at("begin helper") < at("end second"));
console.log("service begins behind helper and second:", at("end helper") < at("begin service") && at("end second") < at("begin service"));
console.log("every file ran once:", order.length === 10 && new Set(order).size === 10);
