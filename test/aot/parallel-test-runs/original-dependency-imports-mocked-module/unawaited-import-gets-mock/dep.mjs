globalThis.got = import("./lib.mjs").then(names => Object.keys(names).sort().join(), error => "threw " + error.name);
export const value = "real";
