globalThis.turns = (globalThis.turns ?? 0) + 1;
if (globalThis.turns === 1) throw new Error("first turn");
export const state = "own";
