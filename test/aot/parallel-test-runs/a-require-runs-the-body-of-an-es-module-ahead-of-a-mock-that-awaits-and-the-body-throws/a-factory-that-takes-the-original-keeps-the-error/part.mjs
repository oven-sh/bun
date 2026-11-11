globalThis.turnsOfPart = (globalThis.turnsOfPart ?? 0) + 1;
if (globalThis.turnsOfPart === 1) throw new Error("the body throws once");
export const word = "own";
