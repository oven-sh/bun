import { r2Name as n_r2, r2Value as v_r2 } from "./r2.mjs";
console.log("SAID r1 runs"); let hits = 0;
export const r1Name = () => "r1";
export const r1Hit = () => ++hits;
export const r1Value = () => "r1" + [n_r2()].join("");
