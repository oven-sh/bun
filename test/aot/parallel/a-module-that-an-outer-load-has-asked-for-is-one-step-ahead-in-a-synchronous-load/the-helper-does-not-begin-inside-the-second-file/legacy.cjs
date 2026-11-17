(globalThis.order ??= []).push("begin legacy");
module.exports = "legacy: " + require("./service.mjs").service;
globalThis.order.push("end legacy");
