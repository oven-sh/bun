(globalThis.order ??= []).push("begin second");
module.exports = "second sees " + typeof require("./helper.cjs");
globalThis.order.push("end second");
