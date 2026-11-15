const show = value => String(JSON.stringify(value)).slice(0, 34);
const first = import.meta.require("./part.mjs", { type: "text" });
const second = await import("./part.mjs");
console.log("ran", globalThis.ran ?? 0, first === second, Object.keys(second).join());
