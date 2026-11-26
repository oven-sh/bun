globalThis.a = (globalThis.a ?? 0) + 1;
console.log("a");
export const v = "a" + globalThis.a;
