(globalThis.order ??= []).push("begin helper");
const { util } = require("./util.mjs");
module.exports = () => util;
globalThis.order.push("end helper");
