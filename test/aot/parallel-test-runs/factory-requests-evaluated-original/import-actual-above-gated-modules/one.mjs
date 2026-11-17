import("./lib.mjs").then(it => console.log("SAID the file below has " + Object.keys(it).sort().join()), error => console.log("SAID the file below hears " + error.name));
await globalThis.gateOne;
export const one = "real";
