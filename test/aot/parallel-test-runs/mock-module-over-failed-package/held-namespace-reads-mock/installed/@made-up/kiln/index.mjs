import "./shelf.mjs";
globalThis.firings = (globalThis.firings ?? 0) + 1;
export let heat = globalThis.firings * 100;
if (globalThis.firings < 2) throw new Error("the kiln is cold");
