globalThis.runsOfPart = (globalThis.runsOfPart || 0) + 1;
let calls = 0;
exports.read = () => "part " + globalThis.runsOfPart + " " + ++calls;
exports.below = () => require("./below.json").word;
