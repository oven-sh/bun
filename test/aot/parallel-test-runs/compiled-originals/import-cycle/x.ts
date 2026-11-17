import { late, viaX } from "./y";
console.log("SAID body");
export function f() { return "f" + late(); }
export const viaY = () => viaX();
export const tag = "x";
