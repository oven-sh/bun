globalThis.bodies = (globalThis.bodies || 0) + 1;
if (globalThis.fails) { globalThis.fails = false; throw new RangeError("wick fails"); }
export const width = () => "real";
