import { Shape } from "./y.mjs";
const ahead = globalThis.declared !== true;
let seen;
try { seen = String(new Shape().area()); } catch (e) { seen = e.name; }
export const told = seen === (ahead ? "TypeError" : "7") ? "as declared" : (ahead ? "ahead of" : "behind") + " the statement: " + seen;
