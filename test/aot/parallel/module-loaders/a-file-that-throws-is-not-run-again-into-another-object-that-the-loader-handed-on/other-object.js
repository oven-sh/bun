globalThis.other = (globalThis.other ?? 0) + 1; console.log("other runs", globalThis.other); exports.part = 1; if (globalThis.other === 1) throw new Error("made up"); exports.whole = 2;
