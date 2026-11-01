import { p } from "./lib.mjs";
console.log(await Promise.race([p, new Promise(r => setTimeout(r, 50, "never settled"))]));
