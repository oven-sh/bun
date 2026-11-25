import { t as GAUGE } from "./lib/gauge.mjs";
console.log("SAID", GAUGE);
if (process.argv.includes("--late")) console.log(Object.keys(await import("./lib/barrel.mjs")).length);
