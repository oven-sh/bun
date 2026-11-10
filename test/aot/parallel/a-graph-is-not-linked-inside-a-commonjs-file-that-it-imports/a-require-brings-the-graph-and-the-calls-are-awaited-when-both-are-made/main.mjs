const first = import("./legacy.cjs");
const second = import("./helper.cjs");
const x = await first;
const h = await second;
console.log("main:", x.default, "| helper is", typeof h.default);
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("service begins inside helper:", at("begin helper") < at("begin service") && at("begin service") < at("end helper"));
console.log("every file ran once:", new Set(order).size === order.length);
