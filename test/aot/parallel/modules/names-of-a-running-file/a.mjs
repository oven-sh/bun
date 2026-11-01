console.log("a starts");
globalThis.inner = import("./b.cjs");
export const fromA = "A".toLowerCase();
console.log("a ends");
