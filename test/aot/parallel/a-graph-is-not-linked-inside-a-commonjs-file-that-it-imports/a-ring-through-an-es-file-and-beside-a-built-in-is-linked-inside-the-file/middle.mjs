import ring from "./ring.cjs";
(globalThis.order ??= []).push("begin middle");
export { ring };
globalThis.order.push("end middle");
