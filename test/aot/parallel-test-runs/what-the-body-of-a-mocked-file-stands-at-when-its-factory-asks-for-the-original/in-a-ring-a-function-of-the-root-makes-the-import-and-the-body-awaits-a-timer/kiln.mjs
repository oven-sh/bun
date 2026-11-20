import { fetchIt } from "./rack.mjs";
globalThis.firings = (globalThis.firings || 0) + 1;
export let glaze = "wet";
export const look = () => "kiln " + glaze;
globalThis.lit();
await globalThis.door;
fetchIt();
while (!globalThis.isAnswered) await new Promise(done => setTimeout(done, 1));
glaze = "dry";
