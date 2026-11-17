globalThis.runs = (globalThis.runs ?? 0) + 1;
export const word = "own";
if (globalThis.runs) throw new Error("part throws " + globalThis.runs);
