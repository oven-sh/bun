globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("dep runs", globalThis.runs);
export const name = "real " + globalThis.runs;
