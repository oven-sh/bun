(globalThis.order ??= []).push("begin helper");
const { util } = require("./util.mjs");
exports.named = () => util;
globalThis.order.push("end helper");
