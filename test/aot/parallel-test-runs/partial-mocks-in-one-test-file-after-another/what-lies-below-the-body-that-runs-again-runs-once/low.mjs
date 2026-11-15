globalThis.lows = (globalThis.lows ?? 0) + 1;
console.log("| body of low " + globalThis.lows);
export const low = "low " + globalThis.lows;
