import { r3Name as n_r3, r3Value as v_r3 } from "./r3.mjs";
console.log("SAID r2 runs"); let hits = 0;
export const r2Name = () => "r2";
export const r2Hit = () => ++hits;
export const r2Value = () => "r2" + [n_r3()].join("");
