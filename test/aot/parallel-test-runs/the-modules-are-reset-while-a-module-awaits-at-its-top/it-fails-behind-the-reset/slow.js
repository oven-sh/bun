globalThis.loads = (globalThis.loads ?? 0) + 1;
const number = globalThis.loads;
globalThis.started?.();
await globalThis.gate;
if (number === 1) throw new Error("the first fails");
export const slow = "done " + number;
