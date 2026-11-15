function show(v) { return typeof v + ":" + String(v); }
import defer * as held from "./lib.mjs";
console.log("SAID deferred", show(held.__esModule), "__esModule" in held, Object.keys(held).join());
