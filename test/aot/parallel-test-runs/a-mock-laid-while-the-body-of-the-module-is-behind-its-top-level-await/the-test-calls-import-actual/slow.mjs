export let state = "early";
export const get = () => "real " + state;
globalThis.bodies = (globalThis.bodies || 0) + 1;
globalThis.tellThatBodyHasBegun?.();
await new Promise(done => setTimeout(done, 20));
state = "late";
export const last = "filled";
