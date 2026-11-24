function show(v) { return typeof v + ":" + String(v); }
const got = require("./lib.mjs");
console.log("SAID required", show(got.__esModule));
import("./via.mjs");
