await import("./middle.mjs");
const load = () => require("./middle.mjs");
const again = load();
console.log(globalThis.seen.join(" "), typeof again);
