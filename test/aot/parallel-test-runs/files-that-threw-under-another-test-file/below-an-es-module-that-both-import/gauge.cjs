globalThis.gaugeRuns = (globalThis.gaugeRuns || 0) + 1;
console.log("gauge.cjs runs", globalThis.gaugeRuns);
if (globalThis.gaugeRuns === 1) throw new Error("not ready yet");
exports.reading = globalThis.gaugeRuns * 10;
