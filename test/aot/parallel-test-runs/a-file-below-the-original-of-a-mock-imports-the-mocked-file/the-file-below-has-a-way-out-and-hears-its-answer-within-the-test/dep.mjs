const asked = import("./lib.mjs");
asked.then(it => console.log("SAID the file below has " + Object.keys(it).sort().join()));
await Promise.race([asked, globalThis.gate]);
export const value = "real";
