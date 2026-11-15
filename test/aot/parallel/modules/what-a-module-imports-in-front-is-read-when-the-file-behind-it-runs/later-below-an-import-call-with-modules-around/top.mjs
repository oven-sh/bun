import "./first.mjs";
import "./plain.cjs";
import "./middle.mjs";
import real from "./real.cjs";
import "./last.mjs";
console.log("top");
export const load = real.load;
