globalThis.runsOfThrown = (globalThis.runsOfThrown || 0) + 1;
if (globalThis.runsOfThrown === 1) throw new Error("the first run throws");
module.exports = function thrown() { return "thrown called"; };
