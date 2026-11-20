(globalThis.order ??= []).push("begin helper");
let got;
try { got = typeof require("./service.mjs").service; } catch (error) { got = error.name; }
globalThis.order.push("required:" + got);
const { util } = require("./util.mjs");
module.exports = () => util;
globalThis.order.push("end helper");
