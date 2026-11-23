import { weigh } from "./weigh.mjs";
function all(xs, at) { let t = 0; for (let r = 0; r < 1; r++) t += weigh(xs, at); return t; }
console.log("SAID", String(all(JSON.parse("[1,2,3,4]"), Number("1"))));
