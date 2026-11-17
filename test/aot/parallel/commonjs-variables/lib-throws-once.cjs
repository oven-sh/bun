globalThis.triesOfThrower = (globalThis.triesOfThrower || 0) + 1;
let state = "fresh " + globalThis.triesOfThrower;
globalThis.keptByThrower = globalThis.keptByThrower || (() => state);
if (globalThis.firstRunOfThrowerFails && globalThis.triesOfThrower === 1) throw new Error("first run");
state = "done";
module.exports = () => state;
