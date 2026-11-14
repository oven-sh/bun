globalThis.runs_third = (globalThis.runs_third ?? 0) + 1;
if (globalThis.runs_third === 1) throw new Error("third gives up");
module.exports = () => "third";
