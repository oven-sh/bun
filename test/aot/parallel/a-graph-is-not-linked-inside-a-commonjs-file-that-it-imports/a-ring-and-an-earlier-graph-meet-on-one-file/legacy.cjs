(globalThis.order ??= []).push("<legacy");
module.exports = "L " + require("./service.mjs").service;
(globalThis.order ??= []).push("legacy>");
