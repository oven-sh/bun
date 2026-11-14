(globalThis as any).log.push("throws runs");
export const value = 5;
throw new Error("thrown while loading");
