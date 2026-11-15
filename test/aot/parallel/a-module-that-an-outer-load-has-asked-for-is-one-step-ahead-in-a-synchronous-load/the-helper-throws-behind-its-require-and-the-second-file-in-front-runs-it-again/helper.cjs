globalThis.runs_helper = (globalThis.runs_helper ?? 0) + 1;
const { util } = require("./util.mjs");
if (globalThis.runs_helper === 1) throw new Error("helper gives up");
module.exports = () => util;
