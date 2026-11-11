export const name = "real kiln";
await globalThis.gate;
const { shelf } = await import("./shelf.mjs");
export const held = "kiln holds " + shelf;
