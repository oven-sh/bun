globalThis.runs_helper = (globalThis.runs_helper ?? 0) + 1;
if (globalThis.runs_helper === 1) throw new Error("helper gives up");
const { util } = require("./util.mjs");
module.exports = () => util;
