globalThis.turnsOfPart = (globalThis.turnsOfPart ?? 0) + 1;
export const word = "own";
if (globalThis.turnsOfPart) throw new Error("the body throws");
