globalThis.loads = (globalThis.loads ?? 0) + 1;
const loads = globalThis.loads;
exports.greet = () => "real " + loads;
