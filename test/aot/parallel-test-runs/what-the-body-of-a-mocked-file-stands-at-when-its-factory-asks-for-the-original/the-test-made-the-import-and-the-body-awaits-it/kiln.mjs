globalThis.firings = (globalThis.firings || 0) + 1;
export let glaze = "wet";
export const look = () => "kiln " + glaze;
globalThis.lit();
await globalThis.door;
await globalThis.shelf;
await new Promise(done => setTimeout(done, 20));
glaze = "dry";
