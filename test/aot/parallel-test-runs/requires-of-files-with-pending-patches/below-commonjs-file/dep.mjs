globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("SAID dep runs");
export const x = "real" + globalThis.runs;
