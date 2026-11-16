const [o, m] = await Promise.all([import("./other.cjs"), import("./ring.cjs")]);
console.log("main:", o.default, JSON.stringify(m.default));
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("back begins inside ring:", at("begin ring") < at("begin back") && at("begin back") < at("end ring"));
