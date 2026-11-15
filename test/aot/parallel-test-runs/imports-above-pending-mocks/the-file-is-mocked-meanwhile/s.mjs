import { cName, cF } from "./c.mjs";
console.log("SAID s runs"); export const sName = "s"; let hits = 0; export const sHit = () => ++hits;
export function sF() { return "s(" + [cName].join() + ")"; }
