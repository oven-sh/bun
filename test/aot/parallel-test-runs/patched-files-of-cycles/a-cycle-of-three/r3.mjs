import { r1Name as n_r1, r1Value as v_r1 } from "./r1.mjs";
import { leafName as n_leaf, leafValue as v_leaf } from "./leaf.mjs";
console.log("SAID r3 runs"); let hits = 0;
export const r3Name = () => "r3";
export const r3Hit = () => ++hits;
export const r3Value = () => "r3" + [n_r1(), n_leaf(), v_leaf()].join("");
