globalThis.runsOfPart = (globalThis.runsOfPart ?? 0) + 1;
if (globalThis.runsOfPart === 1) throw new Error("part fails " + globalThis.runsOfPart);
export const v = "real";
