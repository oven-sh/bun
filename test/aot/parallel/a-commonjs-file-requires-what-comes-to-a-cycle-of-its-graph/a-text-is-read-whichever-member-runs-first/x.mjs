import { readLate } from "./y.mjs";
const ahead = globalThis.declared !== true;
let seen;
try { seen = String(readLate()); } catch (e) { seen = e.name; }
export const told = seen === (ahead ? "ReferenceError" : "4") ? "as declared" : (ahead ? "ahead of" : "behind") + " the declaration: " + seen;
