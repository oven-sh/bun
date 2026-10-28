globalThis.runs = (globalThis.runs ?? 0) + 1;
module.exports = { run: globalThis.runs };
