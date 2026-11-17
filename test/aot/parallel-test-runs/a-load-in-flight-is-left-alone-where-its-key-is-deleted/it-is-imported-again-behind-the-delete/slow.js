globalThis.loads = (globalThis.loads ?? 0) + 1;
globalThis.started?.();
await globalThis.gate;
export const slow = globalThis.loads;
