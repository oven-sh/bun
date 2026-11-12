"use strict";
const out = [];
const descriptor = { value: undefined, enumerable: false };
function factory(name, initializer, Parent) {
  function Inner(def) { this.def = def; this.maker = _; this.traits = new Set(); }
  class Below extends (Parent ?? Object) {}
  function init(inst, def) {
    if (!inst._z) {
      descriptor.value = new Inner(def);
      try { Object.defineProperty(inst, "_z", descriptor); } finally { descriptor.value = undefined; }
    } else if (inst._z.traits.has(name)) return;
    inst._z.traits.add(name);
    initializer(inst, def);
  }
  function _(def) { const inst = Parent ? new Below() : this; init(inst, def); return inst; }
  Object.defineProperty(_, "init", { value: init });
  return _;
}
const Check = factory("Check", function (inst, def) { inst._z.check = function () {}; inst.seen = 0; });
const Least = factory("Least", function (inst, def) { Check.init(inst, def); inst._z.check = function (p) { inst.seen++; if (p.value < def.limit) p.issues.push("least"); }; });
const Most = factory("Most", function (inst, def) { Check.init(inst, def); inst._z.check = function (p) { inst.seen++; if (p.value > def.limit) p.issues.push("most"); }; });
const Failed = factory("Failed", function (inst, def) { inst.note = def.note; }, Error);
const checks = [new Least({ limit: 3 }), new Most({ limit: 9 }), new Least({ limit: 1 })];
function run(value) { const p = { value, issues: [] }; for (const ch of checks) ch._z.check(p); return p.issues.join(); }
for (let i = 0; i < 300; i++) run(i & 15);
out.push(run(0), run(5), run(12), String(checks[0].seen));
const one = checks[0];
out.push(Object.keys(one).join(), JSON.stringify(one), Object.getOwnPropertyNames(one).join(), JSON.stringify(Object.getOwnPropertyDescriptor(one, "_z"), (k, v) => (k === "value" ? "inner" : v)));
out.push(Object.keys({ ...one }).join(), Object.keys(Object.assign({}, one)).join(), Object.entries(one).length + "", String("_z" in one), String(Object.hasOwn(one, "_z")));
const names = []; for (const k in one) names.push(k); out.push(names.join());
try { one._z = 1; out.push("stored"); } catch (e) { out.push(e.constructor.name); }
try { delete one._z; out.push("deleted"); } catch (e) { out.push(e.constructor.name); }
try { Object.defineProperty(one, "_z", { value: 2 }); out.push("defined"); } catch (e) { out.push(e.constructor.name); }
try { Object.defineProperty(one, "_z", { value: one._z, enumerable: false }); out.push("defined as it is"); } catch (e) { out.push(e.constructor.name); }
out.push(String(one._z.maker === Least), [...one._z.traits].join(), Object.keys(one._z).join());
const failed = new Failed({ note: "n" }); out.push(String(failed instanceof Error), failed.note, Object.keys(failed).join(), String(failed._z.maker === Failed));
const plain = {}; Least.init(plain, { limit: 2 }); out.push(Object.keys(plain).join(), Object.getOwnPropertyNames(plain).join(), String(plain._z.def.limit));
const closed = Object.preventExtensions({}); try { Most.init(closed, { limit: 2 }); out.push("laid"); } catch (e) { out.push(e.constructor.name); }
console.log(out.join("\n"));
