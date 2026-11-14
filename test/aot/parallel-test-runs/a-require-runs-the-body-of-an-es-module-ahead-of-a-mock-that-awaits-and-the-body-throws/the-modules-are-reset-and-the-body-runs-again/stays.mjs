globalThis.turnsOfStays = (globalThis.turnsOfStays ?? 0) + 1;
export const word = "own";
if (globalThis.turnsOfStays) throw new Error("the body throws");
