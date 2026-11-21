// Code imported as text first and then required: the require() gives the text, and an import() without a type runs the code.
const text = await import("./gong.cjs", { with: { type: "text" } });
const bell = await import("./bell.mjs", { with: { type: "text" } });
const secondText = import.meta.require("./gong.cjs");
const secondBell = import.meta.require("./bell.mjs");
const gong = await import("./gong.cjs");
const ring = await import("./bell.mjs");
console.log(secondText === text, gong === text, globalThis.struck ?? 0);
console.log(secondBell === bell, ring === bell, Object.keys(ring).join(), globalThis.rung ?? 0);
