// An exported binding read through the namespace of the module itself while it runs.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
import * as self from "./the-namespace-of-the-module-itself-is-read-while-it-runs.js";
console.log(attempt(() => self.later.x), attempt(() => Object.keys(self).join()), attempt(() => "later" in self), attempt(() => Reflect.get(self, "later")), attempt(() => Object.getOwnPropertyDescriptor(self, "later")));
console.log(attempt(() => ({ ...self })), attempt(() => JSON.stringify(self)), attempt(() => Object.values(self)));
export const later = { x: 1 };
console.log(self.later.x);
