globalThis.runs = (globalThis.runs ?? 0) + 1;
export const word = "own";
if (globalThis.runs === 1) throw new Error("part throws");
