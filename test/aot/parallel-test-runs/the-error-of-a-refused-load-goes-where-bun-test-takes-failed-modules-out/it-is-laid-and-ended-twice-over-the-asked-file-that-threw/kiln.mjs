globalThis.firings = (globalThis.firings ?? 0) + 1;
export const kiln = globalThis.firings;
throw new Error("the kiln cracked");
