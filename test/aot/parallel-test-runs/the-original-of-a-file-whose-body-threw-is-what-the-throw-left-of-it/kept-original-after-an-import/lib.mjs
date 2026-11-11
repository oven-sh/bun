globalThis.ran = (globalThis.ran ?? 0) + 1;
export const early = 1;
export const other = 2;
if (early) throw new RangeError("made up");
export const late = 3;
