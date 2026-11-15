(globalThis.order ??= []).push("<helper");
const { util } = require("./util.mjs");
globalThis.back = require("./back.mjs").seen;
module.exports = () => util;
(globalThis.order ??= []).push("helper>");
