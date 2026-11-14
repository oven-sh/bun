export let state = "early"; export const get = () => "real " + state;
globalThis.bodies = (globalThis.bodies || 0) + 1; globalThis.tellThatBodyHasBegun?.();
await globalThis.gate; state = "late";
