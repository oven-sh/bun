globalThis.reads = (globalThis.reads ?? 0) + 1;
if (globalThis.reads === 1) throw new Error("first read");
export const state = "own gauge";
