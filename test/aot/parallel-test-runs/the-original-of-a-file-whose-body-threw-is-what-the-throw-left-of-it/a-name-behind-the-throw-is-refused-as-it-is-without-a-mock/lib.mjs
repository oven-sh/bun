(globalThis.runs ??= []).push("lib");
export const a = 1;
if (a) throw new RangeError("made up");
export const b = 2;
