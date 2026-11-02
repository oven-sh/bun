const g = globalThis;
export const worker = new G.Worker(new URL("./w.mjs", import.meta.url));
