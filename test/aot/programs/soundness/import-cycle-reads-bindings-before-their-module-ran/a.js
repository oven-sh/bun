import { probe } from "./b.js";
export let counter = 0;
export function inc() { counter++; }
export function setText() { counter = "text"; }
export const early = probe;
const secret = { v: 42 };
var hoisted = "set";
export class K { v = secret.v; }
export function peek() { const out = []; for (const f of [() => secret.v, () => hoisted, () => counter, () => new K().v, () => typeof inc]) { try { out.push(String(f())); } catch (e) { out.push(e.name); } } return out.join(); }
export function later() { return peek(); }
