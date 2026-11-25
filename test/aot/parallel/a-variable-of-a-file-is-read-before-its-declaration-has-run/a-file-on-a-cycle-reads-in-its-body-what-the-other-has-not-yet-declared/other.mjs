import { first } from "./main.mjs";
let seen;
try { seen = first; } catch (error) { seen = "threw " + error.constructor.name + ": " + error.message; }
console.log("other", seen);
export const second = 2;
