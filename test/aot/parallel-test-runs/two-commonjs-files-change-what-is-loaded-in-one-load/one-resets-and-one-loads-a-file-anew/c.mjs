globalThis.c = (globalThis.c ?? 0) + 1;
console.log("c");
export const v = "c" + globalThis.c;
