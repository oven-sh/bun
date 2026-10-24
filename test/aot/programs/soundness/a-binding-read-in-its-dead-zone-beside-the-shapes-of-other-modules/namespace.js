// The module reads its own export through its namespace before the declaration has run.
import * as self from "./namespace.js";
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
export const early = attempt(() => self.exported.x);
export const exported = { x: 2 };
console.log("through the namespace", early, self.exported.x);
