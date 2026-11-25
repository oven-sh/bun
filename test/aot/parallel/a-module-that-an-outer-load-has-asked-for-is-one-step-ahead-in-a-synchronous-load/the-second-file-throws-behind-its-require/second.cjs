globalThis.runs_second = (globalThis.runs_second ?? 0) + 1;
const seen = typeof require("./helper.cjs");
if (globalThis.runs_second === 1) throw new Error("second gives up");
module.exports = "second sees " + seen;
