globalThis.runs = (globalThis.runs ?? 0) + 1;
module.exports = { word: "leaf " + globalThis.runs };
