globalThis.sensorRuns = (globalThis.sensorRuns || 0) + 1;
console.log("sensor.cjs runs", globalThis.sensorRuns);
if (globalThis.sensorRuns === 1) throw new Error("cold");
exports.level = globalThis.sensorRuns;
