export let state = "early"; export const get = () => "real " + state;
globalThis.bodies = (globalThis.bodies || 0) + 1; globalThis.tellThatBodyHasBegun?.();
await globalThis.gate; const b = await import("./b.mjs"); state = "late " + b.read();
