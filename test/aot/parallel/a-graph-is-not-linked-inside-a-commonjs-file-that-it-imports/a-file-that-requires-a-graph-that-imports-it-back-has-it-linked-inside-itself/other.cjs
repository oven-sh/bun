(globalThis.order ??= []).push("begin other");
module.exports = "other";
globalThis.order.push("end other");
