exports.a = 1;
globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs === 1)
  throw new RangeError("made up");
exports.b = 2;
