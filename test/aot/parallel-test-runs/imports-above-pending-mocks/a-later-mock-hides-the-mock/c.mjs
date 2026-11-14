import { mName, mF } from "./m.mjs";
console.log("SAID c runs"); export const cName = "c"; let hits = 0; export const cHit = () => ++hits;
export function cF() { return "c(" + [mName].join() + ")"; }
