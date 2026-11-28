globalThis.runs = (globalThis.runs ?? 0) + 1;
const words = require("./words.cjs");
exports.ask = () => globalThis.runs + " " + words.word;
