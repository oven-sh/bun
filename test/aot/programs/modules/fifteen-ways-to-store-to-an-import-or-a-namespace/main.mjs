// Fifteen ways to store to an import or a namespace.
import { v, o } from "./m.mjs";
import * as ns from "./m.mjs";
import d from "./m.mjs";
const r = [];
for (const f of [() => { v = 2; }, () => { v++; }, () => { ns.v = 2; }, () => { d = 1; }, () => { ns.added = 1; }, () => { delete ns.v; }, () => { delete ns.missing; return "ok"; }, () => { o.x = 2; return o.x; }, () => { [v] = [1]; }, () => { ({ v } = { v: 1 }); }, () => { for (v of [1]); }, () => Reflect.set(ns, "v", 3), () => Reflect.defineProperty(ns, "v", { value: 1 }), () => Reflect.defineProperty(ns, "v", { value: 9 }), () => Object.isFrozen(ns)])
  try { r.push(String(f())); } catch (e) { r.push(e.name); }
console.log(r.join(), v);
