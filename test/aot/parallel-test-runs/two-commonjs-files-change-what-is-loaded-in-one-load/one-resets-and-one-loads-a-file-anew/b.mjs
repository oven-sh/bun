globalThis.b = (globalThis.b ?? 0) + 1;
console.log("b");
export const v = "b" + globalThis.b;
