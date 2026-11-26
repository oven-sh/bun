globalThis.d = (globalThis.d ?? 0) + 1;
console.log("dep");
export const v = "d" + globalThis.d;
