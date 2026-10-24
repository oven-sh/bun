import { a } from "./a.mjs";
export const b = "b";
export function readA() { return a; }
try { console.log(readA()); } catch (e) { console.log(e.name); }
