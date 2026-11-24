globalThis.turnsOfEarly = (globalThis.turnsOfEarly ?? 0) + 1;
export const word = "own";
if (globalThis.turnsOfEarly) throw new Error("the body throws");
