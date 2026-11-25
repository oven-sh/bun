import * as dep from "./dep.mjs";
const show = it => it.value() + ":" + String(it.added) + ":" + Object.keys(it).sort().join("+");
export const seen = () => show(dep);
export const held = () => dep;
export const kept = dep;
