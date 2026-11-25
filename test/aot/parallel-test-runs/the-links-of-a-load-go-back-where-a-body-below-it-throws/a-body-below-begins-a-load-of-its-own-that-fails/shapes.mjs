globalThis.asked = import("./asks-for-nothing.mjs").then(() => "loaded", error => error.name);
export const round = 1;
