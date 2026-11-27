import { make } from "./helpers.mjs";
export function use() { try { let s = 0; for (let i = 0; i < 20; i++) s += make(i); console.log("make", s); } catch (e) { console.log("make", e.name); } }
use();
console.log("jobs consumer");
