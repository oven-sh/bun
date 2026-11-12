const kit = require("./index.mjs");
console.log(Object.keys(kit).join());
if (process.env.MADE_UP_NEVER) await import("./fn.cjs");
