const [x, h] = await Promise.all([import("./service.mjs"), import("./helper.cjs")]);
console.log("main:", x.service, "| helper is", typeof h.named);
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("service begins inside helper:", at("begin helper") < at("begin service") && at("begin service") < at("end helper"));
console.log("every file ran once:", new Set(order).size === order.length);
