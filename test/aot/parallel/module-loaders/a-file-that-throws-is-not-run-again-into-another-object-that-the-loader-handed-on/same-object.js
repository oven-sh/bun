globalThis.same = (globalThis.same ?? 0) + 1; console.log("same runs", globalThis.same); exports.part = 1; if (globalThis.same === 1) throw new Error("made up"); exports.whole = 2;
