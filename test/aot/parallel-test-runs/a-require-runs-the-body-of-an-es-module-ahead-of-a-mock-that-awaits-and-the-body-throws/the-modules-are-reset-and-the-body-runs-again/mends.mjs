globalThis.turnsOfMends = (globalThis.turnsOfMends ?? 0) + 1;
export const word = "own";
if (globalThis.turnsOfMends === 1) throw new Error("the body throws once");
