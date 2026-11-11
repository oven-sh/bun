export const early = 1;
await globalThis.gate;
throw new Error("late");
