exports.early = 1;
globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs === 1) throw new Error("the first run ends here");
module.exports = { late: 2 };
