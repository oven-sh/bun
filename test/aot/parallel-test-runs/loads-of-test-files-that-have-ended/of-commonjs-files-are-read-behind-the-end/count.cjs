globalThis.loads = (globalThis.loads ?? 0) + 1;
const load = globalThis.loads;
let turns = 0;
exports.load = load;
exports.turn = () => ++turns;
exports.say = () => `load ${load}, ${turns} turns`;
