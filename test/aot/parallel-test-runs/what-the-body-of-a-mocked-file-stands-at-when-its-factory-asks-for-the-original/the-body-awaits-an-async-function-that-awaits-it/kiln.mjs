globalThis.firings = (globalThis.firings || 0) + 1;
export let glaze = "wet";
export const look = () => "kiln " + glaze;
globalThis.lit();
await globalThis.door;
await (async () => await globalThis.fetchShelf())();
await new Promise(done => setTimeout(done, 20));
glaze = "dry";
