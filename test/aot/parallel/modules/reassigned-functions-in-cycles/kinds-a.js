import { seen } from "./kinds-b.js";
export async function a() { return "a"; }
export function* g() { yield "g"; }
export async function* ag() { yield "ag"; }
export function set(v) { a = v; g = v; ag = v; }
console.log("kinds", seen, typeof a, typeof g, typeof ag);
