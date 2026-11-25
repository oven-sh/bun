import("./leaf.mjs");
let held; const ready = import("./leaf.mjs").then(it => { held = it; });
await ready;
const { word } = await import("./leaf.mjs");
export const view = () => [held.word, word].join();
