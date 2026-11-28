globalThis.b2 = (globalThis.b2 ?? 0) + 1;
console.log("b2");
export const v = "b2" + globalThis.b2;
