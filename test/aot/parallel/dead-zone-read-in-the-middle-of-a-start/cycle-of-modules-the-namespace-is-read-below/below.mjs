import * as main from "./main.mjs";
let seen;
try { seen = main.late.rate; } catch (error) { seen = error.name; }
console.log("below", seen);
