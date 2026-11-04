export const p = import("./lib.mjs").then(() => "loaded", e => "rejected " + e.name);
