import def, { hoisted, v, l, K } from "./a.mjs";
const first = [];
for (const f of [() => hoisted(), () => String(v), () => l, () => K.name, () => def()]) try { first.push(f()); } catch (e) { first.push(e.name); }
console.log(first.join());
export function useA() { return [hoisted(), v, l, K.name, def()].join(); }
