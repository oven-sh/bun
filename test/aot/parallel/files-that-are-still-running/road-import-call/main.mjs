import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.look = null;
await import("./probe.mjs");
const ledger = require("./ledger.cjs");
console.log(ledger.first, ledger.second);
