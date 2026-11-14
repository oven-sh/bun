globalThis.runsOfGauge = (globalThis.runsOfGauge ?? 0) + 1;
if (globalThis.runsOfGauge === 1) throw new Error("the body of the gauge throws");
exports.reading = "full";
