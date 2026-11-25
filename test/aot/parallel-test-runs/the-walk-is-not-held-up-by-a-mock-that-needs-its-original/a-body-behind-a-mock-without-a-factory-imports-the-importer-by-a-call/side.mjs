globalThis.side = "side";
globalThis.late = import("./lamp.mjs").then(lamp => lamp.s, error => error.name);
