export let state = "early"; export const get = () => "real " + state;
globalThis.bodies = (globalThis.bodies || 0) + 1; globalThis.begins?.();
await globalThis.gate; const p = import("./b.mjs"); const b = await p; state = "late " + b.read();
