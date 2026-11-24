globalThis.turnsOfLate = (globalThis.turnsOfLate ?? 0) + 1;
if (globalThis.turnsOfLate) throw new Error("the body throws");
export const word = "own";
