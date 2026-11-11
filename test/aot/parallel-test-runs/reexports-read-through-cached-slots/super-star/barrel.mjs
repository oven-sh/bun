import "./dep.mjs";
export * from "./lib.mjs";
export let own1 = "barrel string one";
export let own2 = { barrel: 2 };
export let own3 = -7;
export let own4 = "barrel string four";
export let own5 = 2.25;
export let own6 = [6];
export let own7 = null;
export let own8 = () => "barrel function";
export function turn() { own1 += "."; own3--; own5 += 1; }
