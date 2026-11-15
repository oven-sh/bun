import { r1Name as n_r1, r1Value as v_r1 } from "./r1.mjs";
import { leafName as n_leaf, leafValue as v_leaf } from "./leaf.mjs";
console.log("SAID r2 runs"); let hits = 0;
export const r2Name = () => "r2";
export const r2Hit = () => ++hits;
export const r2Value = () => "r2" + [n_r1(), n_leaf(), v_leaf()].join("");
