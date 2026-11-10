globalThis.runsOfDep = (globalThis.runsOfDep ?? 0) + 1;
console.log("SAID dep throws");
throw new RangeError("made up");
export const d = "real d";
