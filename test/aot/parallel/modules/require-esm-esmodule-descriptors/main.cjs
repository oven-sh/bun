// Defines, assigns and deletes `__esModule` on the namespace object of a required ES module, with every kind of descriptor.
function show(label, run) {
  try { console.log(label, run()); } catch (error) { console.log(label, "throws", error.name + ": " + error.message); }
}
function describe(ns) {
  const d = Object.getOwnPropertyDescriptor(ns, "__esModule");
  return JSON.stringify({ value: ns.__esModule, own: Object.hasOwn(ns, "__esModule"), in: "__esModule" in ns, keys: Reflect.ownKeys(ns).map(String), names: Object.keys(ns), d: d && { ...d, get: typeof d.get, set: typeof d.set }, extensible: Object.isExtensible(ns), frozen: Object.isFrozen(ns), sealed: Object.isSealed(ns) });
}
const a = require("./e1.mjs");
show("fresh", () => describe(a));
show("define string", () => Object.defineProperty(a, "__esModule", { value: "defined" }) === a);
show("after", () => describe(a));
show("define again", () => Object.defineProperty(a, "__esModule", { value: "again" }) === a);
show("after", () => describe(a));
show("assign", () => { a.__esModule = 5; return describe(a); });
show("strict assign", () => { "use strict"; a.__esModule = 6; return describe(a); });
show("delete", () => [delete a.__esModule, describe(a)].join(" "));

const b = require("./e2.mjs");
show("define writable", () => Object.defineProperty(b, "__esModule", { value: 1, writable: true, enumerable: true, configurable: true }) === b);
show("after", () => describe(b));
show("assign", () => { b.__esModule = 2; return describe(b); });
show("delete", () => [delete b.__esModule, describe(b)].join(" "));
show("reflect delete", () => [Reflect.deleteProperty(b, "__esModule"), describe(b)].join(" "));
show("spread", () => JSON.stringify({ ...b }));
show("for in", () => { const seen = []; for (const k in b) seen.push(k); return seen.join(); });

const c = require("./e3.mjs");
show("define getter", () => Object.defineProperty(c, "__esModule", { get() { return "got"; }, configurable: true }) === c);
show("after", () => describe(c));

const d = require("./e4.mjs");
show("define true", () => Object.defineProperty(d, "__esModule", { value: true }) === d);
show("after", () => describe(d));
show("define false", () => Object.defineProperty(d, "__esModule", { value: false }) === d);
show("after", () => describe(d));

const e = require("./e5.mjs");
show("assign first", () => { e.__esModule = 0; return describe(e); });
show("assign true", () => { e.__esModule = true; return describe(e); });
show("assign text", () => { e.__esModule = "text"; return describe(e); });
show("define empty", () => Object.defineProperty(e, "__esModule", {}) === e);
show("after", () => describe(e));

const f = require("./e6.mjs");
show("reflect define", () => Reflect.defineProperty(f, "__esModule", { value: undefined }));
show("after", () => describe(f));
show("reflect define other", () => Reflect.defineProperty(f, "other", { value: 1 }));
show("define other", () => Object.defineProperty(f, "other", { value: 1 }));
show("reflect set", () => Reflect.set(f, "__esModule", 9));
show("after", () => describe(f));

const g = require("./marked.mjs");
show("own export", () => describe(g));
show("define over export", () => Object.defineProperty(g, "__esModule", { value: "defined" }) === g);
show("assign over export", () => { g.__esModule = 1; return describe(g); });

import("./e7.mjs").then(ns => {
  show("imported fresh", () => describe(ns));
  show("imported define", () => Object.defineProperty(ns, "__esModule", { value: "defined" }) === ns);
  show("imported after", () => describe(ns));
  show("required same", () => require("./e7.mjs") === ns);
  show("required after", () => describe(require("./e7.mjs")));
  return import("./e8.mjs");
}).then(ns => {
  show("imported assign", () => { ns.__esModule = 0; return describe(ns); });
  show("then required", () => describe(require("./e8.mjs")));
  show("freeze", () => Object.freeze(require("./e9.mjs")) && "frozen");
  show("seal", () => Object.seal(require("./e9.mjs")) && "sealed");
  show("prevent", () => Object.preventExtensions(require("./e9.mjs")) && "prevented");
  show("define behind prevent", () => Object.defineProperty(require("./e9.mjs"), "__esModule", { value: "late" }) && describe(require("./e9.mjs")));
});
