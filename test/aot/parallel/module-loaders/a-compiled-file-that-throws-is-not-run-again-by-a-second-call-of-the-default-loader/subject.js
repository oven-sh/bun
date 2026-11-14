globalThis.runs = (globalThis.runs ?? 0) + 1; console.log("subject runs", globalThis.runs); exports.part = 1; if (globalThis.runs === 1) throw new Error("made up"); exports.whole = 2;
