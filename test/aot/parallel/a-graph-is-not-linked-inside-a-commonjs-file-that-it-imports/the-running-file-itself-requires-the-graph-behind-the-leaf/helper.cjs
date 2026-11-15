(globalThis.order ??= []).push("begin helper");
const { util } = require("./util.mjs");
module.exports = () => util;
let got;
got = typeof require("./service.mjs").service;
globalThis.order.push("required:" + got);
globalThis.order.push("end helper");
