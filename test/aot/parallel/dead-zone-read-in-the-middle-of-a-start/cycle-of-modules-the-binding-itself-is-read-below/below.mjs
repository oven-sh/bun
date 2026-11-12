import { late } from "./main.mjs";
let seen;
try { seen = late.rate; } catch (error) { seen = error.name; }
console.log("below", seen);
