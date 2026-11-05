globalThis.sharedLoads = (globalThis.sharedLoads ?? 0) + 1;
export const shared = globalThis.sharedLoads;
