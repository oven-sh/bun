globalThis.loads = (globalThis.loads ?? 0) + 1;
export const number = globalThis.loads;
globalThis.started?.();
await globalThis.gate;
export const slow = "done " + number;
