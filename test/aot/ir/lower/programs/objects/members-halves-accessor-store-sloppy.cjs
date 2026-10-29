// RUN: lower
// OPTIONS: builtin-modules

// Object literals whose getters and setters read a variable of the function round the literal, and between the two halves of an accessor stands a member that runs code: it stores to the variable by name, through `arguments`, inside a `with`, in evaluated text.
// Each half finds what the variable holds when the half is called, whatever stood where in the literal. Each literal is made two dozen times.
const id = x => x;
const tag = (texts, ...values) => values.join();
class Box { constructor(x) { this.x = x; } }
const more = { z: 1 };
const scope = { unrelated: 1 };
function show(o, seen) {
  const out = [];
  for (const k of Reflect.ownKeys(o)) {
    const found = Object.getOwnPropertyDescriptor(o, k);
    if ("value" in found) {
      const value = found.value;
      out.push(String(k) + "=" + (typeof value === "function" ? (String(k)[0] === "f" ? "f:" + o[k]() : "function") : typeof value === "object" ? JSON.stringify(value) : String(value)));
      continue;
    }
    const got = found.get ? String(o[k]) : "-";
    let put = "-";
    if (found.set) {
      seen.length = 0;
      o[k] = "x";
      o[k] = undefined;
      put = seen.join("/");
    }
    out.push(String(k) + ":" + got + "|" + put + (found.enumerable ? "e" : "") + (found.configurable ? "c" : ""));
  }
  return out.join(" ") + (Object.getPrototypeOf(o) === null ? " bare" : "");
}
const seen = [];
const makers = {
  "store, the setter first"(v) { var c = 0; return { set p(x) { seen.push((() => c)(), x); }, q1: (c = (v + 1)), get p() { return (() => c)(); } }; },
  "store, the getter first"(v, c = 0) { function helper() { return c; } return { get p() { return helper(); }, q1: (c = (v + 1)), set p(x) { seen.push(helper(), x); } }; },
  "store, stored again behind the literal"(v) { let c; c = 0; const d = v * 2; const o = { set p(x = [c, d].join()) { seen.push(x); }, q1: (c = (v + 1)), get p() { return [c, d].join(); } }; c += 100; return o; },
  "add, the setter first"(v) { let c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: (c += 1), get p() { return (() => () => c)()(); } }; },
  "add, the getter first"(v) { var c = 0; return { get p() { return c; }, q1: (c += 1), set p(x) { seen.push(c, x); } }; },
  "add, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => c)(), x); }, q1: (c += 1), get p() { return (() => c)(); } }; late(); return o; },
  "post, the setter first"(v) { let c; c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: c++, get p() { return helper(); } }; },
  "post, the getter first"(v) { let c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, q1: c++, set p(x) { seen.push([c, d].join(), x); } }; },
  "post, stored again behind the literal"(v) { var c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: c++, get p() { return (() => () => c)()(); } }; c += 100; return o; },
  "pre, the setter first"(v, c = 0) { return { set p(x = c) { seen.push(x); }, q1: ++c, get p() { return c; } }; },
  "pre, the getter first"(v) { let c; c = 0; return { get p() { return (() => c)(); }, q1: ++c, set p(x) { seen.push((() => c)(), x); } }; },
  "pre, stored again behind the literal"(v) { let c = 0; function helper() { return c; } const late = () => { c += 1000; }; const o = { set p(x) { seen.push(helper(), x); }, q1: ++c, get p() { return helper(); } }; late(); return o; },
  "list-pattern, the setter first"(v) { var c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, q1: ([c] = [(v + 1)]), get p() { return [c, d].join(); } }; },
  "list-pattern, the getter first"(v, c = 0) { return { get p() { return (() => () => c)()(); }, q1: ([c] = [(v + 1)]), set p(x) { seen.push((() => () => c)()(), x); } }; },
  "list-pattern, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push(c, x); }, q1: ([c] = [(v + 1)]), get p() { return c; } }; c += 100; return o; },
  "object-pattern, the setter first"(v) { let c = 0; return { set p(x) { seen.push((() => c)(), x); }, q1: ({ c } = { c: (v + 1) }), get p() { return (() => c)(); } }; },
  "object-pattern, the getter first"(v) { var c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: ({ c } = { c: (v + 1) }), set p(x = helper()) { seen.push(x); } }; },
  "object-pattern, stored again behind the literal"(v, c = 0) { const d = v * 2; const late = () => { c += 1000; }; const o = { set p(x) { seen.push([c, d].join(), x); }, q1: ({ c } = { c: (v + 1) }), get p() { return [c, d].join(); } }; late(); return o; },
  "pattern-default, the setter first"(v) { let c; c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: ([c = (v + 1)] = []), get p() { return (() => () => c)()(); } }; },
  "pattern-default, the getter first"(v) { let c = 0; return { get p() { return c; }, q1: ([c = (v + 1)] = []), set p(x) { seen.push(c, x); } }; },
  "pattern-default, stored again behind the literal"(v) { var c = 0; const o = { set p(x) { seen.push((() => c)(), x); }, q1: ([c = (v + 1)] = []), get p() { return (() => c)(); } }; c += 100; return o; },
  "and, the setter first"(v, c = 0) { function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: (c &&= (v + 1)), get p() { return helper(); } }; },
  "and, the getter first"(v) { let c; c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, q1: (c &&= (v + 1)), set p(x) { seen.push([c, d].join(), x); } }; },
  "and, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x = (() => () => c)()()) { seen.push(x); }, q1: (c &&= (v + 1)), get p() { return (() => () => c)()(); } }; late(); return o; },
  "or, the setter first"(v) { var c = 0; return { set p(x) { seen.push(c, x); }, q1: (c ||= (v + 1)), get p() { return c; } }; },
  "or, the getter first"(v, c = 0) { return { get p() { return (() => c)(); }, q1: (c ||= (v + 1)), set p(x) { seen.push((() => c)(), x); } }; },
  "or, stored again behind the literal"(v) { let c; c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, q1: (c ||= (v + 1)), get p() { return helper(); } }; c += 100; return o; },
  "nullish, the setter first"(v) { let c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, q1: (c ??= (v + 1)), get p() { return [c, d].join(); } }; },
  "nullish, the getter first"(v) { var c = 0; return { get p() { return (() => () => c)()(); }, q1: (c ??= (v + 1)), set p(x) { seen.push((() => () => c)()(), x); } }; },
  "nullish, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x) { seen.push(c, x); }, q1: (c ??= (v + 1)), get p() { return c; } }; late(); return o; },
  "branch, the setter first"(v) { let c; c = 0; return { set p(x = (() => c)()) { seen.push(x); }, q1: v & 1 ? (c = (v + 1)) : 0, get p() { return (() => c)(); } }; },
  "branch, the getter first"(v) { let c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: v & 1 ? (c = (v + 1)) : 0, set p(x) { seen.push(helper(), x); } }; },
  "branch, stored again behind the literal"(v) { var c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, q1: v & 1 ? (c = (v + 1)) : 0, get p() { return [c, d].join(); } }; c += 100; return o; },
  "inner-literal, the setter first"(v, c = 0) { return { set p(x) { seen.push((() => () => c)()(), x); }, q1: { w: (c = (v + 1)) }, get p() { return (() => () => c)()(); } }; },
  "inner-literal, the getter first"(v) { let c; c = 0; return { get p() { return c; }, q1: { w: (c = (v + 1)) }, set p(x) { seen.push(c, x); } }; },
  "inner-literal, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => c)(), x); }, q1: { w: (c = (v + 1)) }, get p() { return (() => c)(); } }; late(); return o; },
  "inner-list, the setter first"(v) { var c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: [(c = (v + 1))], get p() { return helper(); } }; },
  "inner-list, the getter first"(v, c = 0) { const d = v * 2; return { get p() { return [c, d].join(); }, q1: [(c = (v + 1))], set p(x = [c, d].join()) { seen.push(x); } }; },
  "inner-list, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: [(c = (v + 1))], get p() { return (() => () => c)()(); } }; c += 100; return o; },
  "argument, the setter first"(v) { let c = 0; return { set p(x) { seen.push(c, x); }, q1: id((c = (v + 1))), get p() { return c; } }; },
  "argument, the getter first"(v) { var c = 0; return { get p() { return (() => c)(); }, q1: id((c = (v + 1))), set p(x) { seen.push((() => c)(), x); } }; },
  "argument, stored again behind the literal"(v, c = 0) { function helper() { return c; } const late = () => { c += 1000; }; const o = { set p(x) { seen.push(helper(), x); }, q1: id((c = (v + 1))), get p() { return helper(); } }; late(); return o; },
  "template, the setter first"(v) { let c; c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, q1: `${(c = (v + 1))}`, get p() { return [c, d].join(); } }; },
  "template, the getter first"(v) { let c = 0; return { get p() { return (() => () => c)()(); }, q1: `${(c = (v + 1))}`, set p(x) { seen.push((() => () => c)()(), x); } }; },
  "template, stored again behind the literal"(v) { var c = 0; const o = { set p(x = c) { seen.push(x); }, q1: `${(c = (v + 1))}`, get p() { return c; } }; c += 100; return o; },
  "comma, the setter first"(v, c = 0) { return { set p(x) { seen.push((() => c)(), x); }, q1: ((c = (v + 1)), 0), get p() { return (() => c)(); } }; },
  "comma, the getter first"(v) { let c; c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: ((c = (v + 1)), 0), set p(x) { seen.push(helper(), x); } }; },
  "comma, stored again behind the literal"(v) { let c = 0; const d = v * 2; const late = () => { c += 1000; }; const o = { set p(x) { seen.push([c, d].join(), x); }, q1: ((c = (v + 1)), 0), get p() { return [c, d].join(); } }; late(); return o; },
  "void, the setter first"(v) { var c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: void (c = (v + 1)), get p() { return (() => () => c)()(); } }; },
  "void, the getter first"(v, c = 0) { return { get p() { return c; }, q1: void (c = (v + 1)), set p(x) { seen.push(c, x); } }; },
  "void, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push((() => c)(), x); }, q1: void (c = (v + 1)), get p() { return (() => c)(); } }; c += 100; return o; },
  "closure-stores, the setter first"(v) { let c = 0; function helper() { return c; } const bump = n => (c = n); return { set p(x = helper()) { seen.push(x); }, q1: bump((v + 1)), get p() { return helper(); } }; },
  "closure-stores, the getter first"(v) { var c = 0; const d = v * 2; const bump = n => (c = n); return { get p() { return [c, d].join(); }, q1: bump((v + 1)), set p(x) { seen.push([c, d].join(), x); } }; },
  "closure-stores, stored again behind the literal"(v, c = 0) { const bump = n => (c = n); const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: bump((v + 1)), get p() { return (() => () => c)()(); } }; late(); return o; },
  "arrow-called, the setter first"(v) { let c; c = 0; return { set p(x) { seen.push(c, x); }, q1: (() => (c = (v + 1)))(), get p() { return c; } }; },
  "arrow-called, the getter first"(v) { let c = 0; return { get p() { return (() => c)(); }, q1: (() => (c = (v + 1)))(), set p(x) { seen.push((() => c)(), x); } }; },
  "arrow-called, stored again behind the literal"(v) { var c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, q1: (() => (c = (v + 1)))(), get p() { return helper(); } }; c += 100; return o; },
  "call, the setter first"(v, c = 0) { const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, q1: id((v + 1)), get p() { return [c, d].join(); } }; },
  "call, the getter first"(v) { let c; c = 0; return { get p() { return (() => () => c)()(); }, q1: id((v + 1)), set p(x = (() => () => c)()()) { seen.push(x); } }; },
  "call, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x) { seen.push(c, x); }, q1: id((v + 1)), get p() { return c; } }; late(); return o; },
  "spread-stores, the setter first"(v) { var c = 0; return { set p(x) { seen.push((() => c)(), x); }, ...((c = (v + 1)), { z1: 1 }), get p() { return (() => c)(); } }; },
  "spread-stores, the getter first"(v, c = 0) { function helper() { return c; } return { get p() { return helper(); }, ...((c = (v + 1)), { z1: 1 }), set p(x) { seen.push(helper(), x); } }; },
  "spread-stores, stored again behind the literal"(v) { let c; c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, ...((c = (v + 1)), { z1: 1 }), get p() { return [c, d].join(); } }; c += 100; return o; },
  "spread, the setter first"(v) { let c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, ...more, get p() { return (() => () => c)()(); } }; },
  "spread, the getter first"(v) { var c = 0; return { get p() { return c; }, ...more, set p(x) { seen.push(c, x); } }; },
  "spread, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x = (() => c)()) { seen.push(x); }, ...more, get p() { return (() => c)(); } }; late(); return o; },
  "key-stores, the setter first"(v) { let c; c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, [((c = (v + 1)), "k1")]: 1, get p() { return helper(); } }; },
  "key-stores, the getter first"(v) { let c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, [((c = (v + 1)), "k1")]: 1, set p(x) { seen.push([c, d].join(), x); } }; },
  "key-stores, stored again behind the literal"(v) { var c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, [((c = (v + 1)), "k1")]: 1, get p() { return (() => () => c)()(); } }; c += 100; return o; },
  "key-is-the-name, the setter first"(v, c = 0) { return { set p(x) { seen.push(c, x); }, [((c = (v + 1)), "p")]: 1, get p() { return c; } }; },
  "key-is-the-name, the getter first"(v) { let c; c = 0; return { get p() { return (() => c)(); }, [((c = (v + 1)), "p")]: 1, set p(x) { seen.push((() => c)(), x); } }; },
  "key-is-the-name, stored again behind the literal"(v) { let c = 0; function helper() { return c; } const late = () => { c += 1000; }; const o = { set p(x) { seen.push(helper(), x); }, [((c = (v + 1)), "p")]: 1, get p() { return helper(); } }; late(); return o; },
  "prototype, the setter first"(v) { var c = 0; const d = v * 2; return { set p(x = [c, d].join()) { seen.push(x); }, __proto__: ((c = (v + 1)), null), get p() { return [c, d].join(); } }; },
  "prototype, the getter first"(v, c = 0) { return { get p() { return (() => () => c)()(); }, __proto__: ((c = (v + 1)), null), set p(x) { seen.push((() => () => c)()(), x); } }; },
  "prototype, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push(c, x); }, __proto__: ((c = (v + 1)), null), get p() { return c; } }; c += 100; return o; },
  "class-key, the setter first"(v) { let c = 0; return { set p(x) { seen.push((() => c)(), x); }, q1: class { [(c = (v + 1))]() {} }, get p() { return (() => c)(); } }; },
  "class-key, the getter first"(v) { var c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: class { [(c = (v + 1))]() {} }, set p(x) { seen.push(helper(), x); } }; },
  "class-key, stored again behind the literal"(v, c = 0) { const d = v * 2; const late = () => { c += 1000; }; const o = { set p(x) { seen.push([c, d].join(), x); }, q1: class { [(c = (v + 1))]() {} }, get p() { return [c, d].join(); } }; late(); return o; },
  "class-block, the setter first"(v) { let c; c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: class { static { c = (v + 1); } }, get p() { return (() => () => c)()(); } }; },
  "class-block, the getter first"(v) { let c = 0; return { get p() { return c; }, q1: class { static { c = (v + 1); } }, set p(x = c) { seen.push(x); } }; },
  "class-block, stored again behind the literal"(v) { var c = 0; const o = { set p(x) { seen.push((() => c)(), x); }, q1: class { static { c = (v + 1); } }, get p() { return (() => c)(); } }; c += 100; return o; },
  "class-field, the setter first"(v, c = 0) { function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: class { static f = (c = (v + 1)); }, get p() { return helper(); } }; },
  "class-field, the getter first"(v) { let c; c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, q1: class { static f = (c = (v + 1)); }, set p(x) { seen.push([c, d].join(), x); } }; },
  "class-field, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: class { static f = (c = (v + 1)); }, get p() { return (() => () => c)()(); } }; late(); return o; },
  "class-heritage, the setter first"(v) { var c = 0; return { set p(x) { seen.push(c, x); }, q1: class extends ((c = (v + 1)), Object) {}, get p() { return c; } }; },
  "class-heritage, the getter first"(v, c = 0) { return { get p() { return (() => c)(); }, q1: class extends ((c = (v + 1)), Object) {}, set p(x) { seen.push((() => c)(), x); } }; },
  "class-heritage, stored again behind the literal"(v) { let c; c = 0; function helper() { return c; } const o = { set p(x = helper()) { seen.push(x); }, q1: class extends ((c = (v + 1)), Object) {}, get p() { return helper(); } }; c += 100; return o; },
  "method-key, the setter first"(v) { let c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, [((c = (v + 1)), "m1")]() {}, get p() { return [c, d].join(); } }; },
  "method-key, the getter first"(v) { var c = 0; return { get p() { return (() => () => c)()(); }, [((c = (v + 1)), "m1")]() {}, set p(x) { seen.push((() => () => c)()(), x); } }; },
  "method-key, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x) { seen.push(c, x); }, [((c = (v + 1)), "m1")]() {}, get p() { return c; } }; late(); return o; },
  "getter-key, the setter first"(v) { let c; c = 0; return { set p(x) { seen.push((() => c)(), x); }, get [((c = (v + 1)), "g1")]() { return 1; }, get p() { return (() => c)(); } }; },
  "getter-key, the getter first"(v) { let c = 0; function helper() { return c; } return { get p() { return helper(); }, get [((c = (v + 1)), "g1")]() { return 1; }, set p(x) { seen.push(helper(), x); } }; },
  "getter-key, stored again behind the literal"(v) { var c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, get [((c = (v + 1)), "g1")]() { return 1; }, get p() { return [c, d].join(); } }; c += 100; return o; },
  "tag, the setter first"(v, c = 0) { return { set p(x = (() => () => c)()()) { seen.push(x); }, q1: tag`${(c = (v + 1))}`, get p() { return (() => () => c)()(); } }; },
  "tag, the getter first"(v) { let c; c = 0; return { get p() { return c; }, q1: tag`${(c = (v + 1))}`, set p(x) { seen.push(c, x); } }; },
  "tag, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => c)(), x); }, q1: tag`${(c = (v + 1))}`, get p() { return (() => c)(); } }; late(); return o; },
  "optional-call, the setter first"(v) { var c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: id?.((c = (v + 1))), get p() { return helper(); } }; },
  "optional-call, the getter first"(v, c = 0) { const d = v * 2; return { get p() { return [c, d].join(); }, q1: id?.((c = (v + 1))), set p(x) { seen.push([c, d].join(), x); } }; },
  "optional-call, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: id?.((c = (v + 1))), get p() { return (() => () => c)()(); } }; c += 100; return o; },
  "new, the setter first"(v) { let c = 0; return { set p(x) { seen.push(c, x); }, q1: new Box((c = (v + 1))), get p() { return c; } }; },
  "new, the getter first"(v) { var c = 0; return { get p() { return (() => c)(); }, q1: new Box((c = (v + 1))), set p(x = (() => c)()) { seen.push(x); } }; },
  "new, stored again behind the literal"(v, c = 0) { function helper() { return c; } const late = () => { c += 1000; }; const o = { set p(x) { seen.push(helper(), x); }, q1: new Box((c = (v + 1))), get p() { return helper(); } }; late(); return o; },
  "shorthand, the setter first"(v) { let c; c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, c, get p() { return [c, d].join(); } }; },
  "shorthand, the getter first"(v) { let c = 0; return { get p() { return (() => () => c)()(); }, c, set p(x) { seen.push((() => () => c)()(), x); } }; },
  "shorthand, stored again behind the literal"(v) { var c = 0; const o = { set p(x) { seen.push(c, x); }, c, get p() { return c; } }; c += 100; return o; },
  "read, the setter first"(v, c = 0) { return { set p(x) { seen.push((() => c)(), x); }, q1: c, get p() { return (() => c)(); } }; },
  "read, the getter first"(v) { let c; c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: c, set p(x) { seen.push(helper(), x); } }; },
  "read, stored again behind the literal"(v) { let c = 0; const d = v * 2; const late = () => { c += 1000; }; const o = { set p(x = [c, d].join()) { seen.push(x); }, q1: c, get p() { return [c, d].join(); } }; late(); return o; },
  "arrow, the setter first"(v) { var c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, f1: () => c, get p() { return (() => () => c)()(); } }; },
  "arrow, the getter first"(v, c = 0) { return { get p() { return c; }, f1: () => c, set p(x) { seen.push(c, x); } }; },
  "arrow, stored again behind the literal"(v) { let c; c = 0; const o = { set p(x) { seen.push((() => c)(), x); }, f1: () => c, get p() { return (() => c)(); } }; c += 100; return o; },
  "store-and-arrow, the setter first"(v) { let c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, f1: ((c = (v + 1)), () => c), get p() { return helper(); } }; },
  "store-and-arrow, the getter first"(v) { var c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, f1: ((c = (v + 1)), () => c), set p(x) { seen.push([c, d].join(), x); } }; },
  "store-and-arrow, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => () => c)()(), x); }, f1: ((c = (v + 1)), () => c), get p() { return (() => () => c)()(); } }; late(); return o; },
  "method, the setter first"(v) { let c; c = 0; return { set p(x = c) { seen.push(x); }, f1() { return c; }, get p() { return c; } }; },
  "method, the getter first"(v) { let c = 0; return { get p() { return (() => c)(); }, f1() { return c; }, set p(x) { seen.push((() => c)(), x); } }; },
  "method, stored again behind the literal"(v) { var c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, f1() { return c; }, get p() { return helper(); } }; c += 100; return o; },
  "constant, the setter first"(v, c = 0) { const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, q1: 1, get p() { return [c, d].join(); } }; },
  "constant, the getter first"(v) { let c; c = 0; return { get p() { return (() => () => c)()(); }, q1: 1, set p(x) { seen.push((() => () => c)()(), x); } }; },
  "constant, stored again behind the literal"(v) { let c = 0; const late = () => { c += 1000; }; const o = { set p(x) { seen.push(c, x); }, q1: 1, get p() { return c; } }; late(); return o; },
  *"yield-value, the setter first"(v) { var c = 0; return { set p(x) { seen.push((() => c)(), x); }, q1: (c = yield (v + 1)), get p() { return (() => c)(); } }; },
  *"yield-value, the getter first"(v, c = 0) { function helper() { return c; } return { get p() { return helper(); }, q1: (c = yield (v + 1)), set p(x = helper()) { seen.push(x); } }; },
  *"yield-value, stored again behind the literal"(v) { let c; c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, q1: (c = yield (v + 1)), get p() { return [c, d].join(); } }; c += 100; return o; },
  *"store-yield, the setter first"(v) { let c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: ((c = (v + 1)), yield 0), get p() { return (() => () => c)()(); } }; },
  *"store-yield, the getter first"(v) { var c = 0; return { get p() { return c; }, q1: ((c = (v + 1)), yield 0), set p(x) { seen.push(c, x); } }; },
  *"store-yield, stored again behind the literal"(v, c = 0) { const late = () => { c += 1000; }; const o = { set p(x) { seen.push((() => c)(), x); }, q1: ((c = (v + 1)), yield 0), get p() { return (() => c)(); } }; late(); return o; },
  "eval, the setter first"(v) { let c; c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, q1: eval("c = " + (v + 1)), get p() { return helper(); } }; },
  "eval, the getter first"(v) { let c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, q1: eval("c = " + (v + 1)), set p(x) { seen.push([c, d].join(), x); } }; },
  "eval, stored again behind the literal"(v) { var c = 0; const o = { set p(x = (() => () => c)()()) { seen.push(x); }, q1: eval("c = " + (v + 1)), get p() { return (() => () => c)()(); } }; c += 100; return o; },
  "arguments, the setter first"(v, c) { return { set p(x) { seen.push(c, x); }, q1: (arguments[1] = (v + 1)), get p() { return c; } }; },
  "arguments, the getter first"(v, c) { return { get p() { return (() => c)(); }, q1: (arguments[1] = (v + 1)), set p(x) { seen.push((() => c)(), x); } }; },
  "arguments, stored again behind the literal"(v, c) { function helper() { return c; } const late = () => { c += 1000; }; const o = { set p(x) { seen.push(helper(), x); }, q1: (arguments[1] = (v + 1)), get p() { return helper(); } }; late(); return o; },
  "with, the setter first"(v) { var c = 0; const d = v * 2; with (scope) { return { set p(x) { seen.push([c, d].join(), x); }, q1: (c = (v + 1)), get p() { return [c, d].join(); } }; } },
  "with, the getter first"(v, c = 0) { with (scope) { return { get p() { return (() => () => c)()(); }, q1: (c = (v + 1)), set p(x) { seen.push((() => () => c)()(), x); } }; } },
  "with, stored again behind the literal"(v) { let c; c = 0; with (scope) { const o = { set p(x) { seen.push(c, x); }, q1: (c = (v + 1)), get p() { return c; } }; c += 100; return o; } },
  "store, S0 S1 B G0 G1"(v) { let c = 0; return { set p(x) { seen.push((() => c)(), x); }, set r(x) { seen.push((() => c)(), x); }, q1: (c = (v + 1)), get p() { return (() => c)(); }, get r() { return (() => c)(); } }; },
  "post, S0 S1 B G0 G1"(v) { var c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, set r(x) { seen.push(helper(), x); }, q1: c++, get p() { return helper(); }, get r() { return helper(); } }; c += 100; return o; },
  "closure-stores, S0 S1 B G0 G1"(v, c = 0) { const d = v * 2; const bump = n => (c = n); return { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, q1: bump((v + 1)), get p() { return [c, d].join(); }, get r() { return [c, d].join(); } }; },
  "spread-stores, S0 S1 B G0 G1"(v) { let c; c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, set r(x) { seen.push((() => () => c)()(), x); }, ...((c = (v + 1)), { z1: 1 }), get p() { return (() => () => c)()(); }, get r() { return (() => () => c)()(); } }; },
  "key-stores, S0 S1 B G0 G1"(v) { let c = 0; const o = { set p(x) { seen.push(c, x); }, set r(x) { seen.push(c, x); }, [((c = (v + 1)), "k1")]: 1, get p() { return c; }, get r() { return c; } }; c += 100; return o; },
  *"yield-value, S0 S1 B G0 G1"(v) { var c = 0; return { set p(x) { seen.push((() => c)(), x); }, set r(x) { seen.push((() => c)(), x); }, q1: (c = yield (v + 1)), get p() { return (() => c)(); }, get r() { return (() => c)(); } }; },
  "arguments, S0 S1 B G0 G1"(v, c) { function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, set r(x) { seen.push(helper(), x); }, q1: (arguments[1] = (v + 1)), get p() { return helper(); }, get r() { return helper(); } }; },
  "with, S0 S1 B G0 G1"(v) { let c; c = 0; const d = v * 2; with (scope) { const o = { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, q1: (c = (v + 1)), get p() { return [c, d].join(); }, get r() { return [c, d].join(); } }; c += 100; return o; } },
  "store, S0 B S1 B G0 B G1"(v) { let c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: (c = (v + 1)), set r(x) { seen.push((() => () => c)()(), x); }, q2: (c = (v + 2)), get p() { return (() => () => c)()(); }, q3: (c = (v + 3)), get r() { return (() => () => c)()(); } }; },
  "post, S0 B S1 B G0 B G1"(v) { var c = 0; return { set p(x) { seen.push(c, x); }, q1: c++, set r(x) { seen.push(c, x); }, q2: c++, get p() { return c; }, q3: c++, get r() { return c; } }; },
  "closure-stores, S0 B S1 B G0 B G1"(v, c = 0) { const bump = n => (c = n); const o = { set p(x) { seen.push((() => c)(), x); }, q1: bump((v + 1)), set r(x) { seen.push((() => c)(), x); }, q2: bump((v + 2)), get p() { return (() => c)(); }, q3: bump((v + 3)), get r() { return (() => c)(); } }; c += 100; return o; },
  "spread-stores, S0 B S1 B G0 B G1"(v) { let c; c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, ...((c = (v + 1)), { z1: 1 }), set r(x) { seen.push(helper(), x); }, ...((c = (v + 2)), { z2: 1 }), get p() { return helper(); }, ...((c = (v + 3)), { z3: 1 }), get r() { return helper(); } }; },
  "key-stores, S0 B S1 B G0 B G1"(v) { let c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, [((c = (v + 1)), "k1")]: 1, set r(x) { seen.push([c, d].join(), x); }, [((c = (v + 2)), "k2")]: 1, get p() { return [c, d].join(); }, [((c = (v + 3)), "k3")]: 1, get r() { return [c, d].join(); } }; },
  *"yield-value, S0 B S1 B G0 B G1"(v) { var c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, q1: (c = yield (v + 1)), set r(x) { seen.push((() => () => c)()(), x); }, q2: (c = yield (v + 2)), get p() { return (() => () => c)()(); }, q3: (c = yield (v + 3)), get r() { return (() => () => c)()(); } }; c += 100; return o; },
  "arguments, S0 B S1 B G0 B G1"(v, c) { return { set p(x) { seen.push(c, x); }, q1: (arguments[1] = (v + 1)), set r(x) { seen.push(c, x); }, q2: (arguments[1] = (v + 2)), get p() { return c; }, q3: (arguments[1] = (v + 3)), get r() { return c; } }; },
  "with, S0 B S1 B G0 B G1"(v) { let c; c = 0; with (scope) { return { set p(x) { seen.push((() => c)(), x); }, q1: (c = (v + 1)), set r(x) { seen.push((() => c)(), x); }, q2: (c = (v + 2)), get p() { return (() => c)(); }, q3: (c = (v + 3)), get r() { return (() => c)(); } }; } },
  "store, G0 S1 B S0 B G1"(v) { let c = 0; function helper() { return c; } const o = { get p() { return helper(); }, set r(x) { seen.push(helper(), x); }, q1: (c = (v + 1)), set p(x) { seen.push(helper(), x); }, q2: (c = (v + 2)), get r() { return helper(); } }; c += 100; return o; },
  "post, G0 S1 B S0 B G1"(v) { var c = 0; const d = v * 2; return { get p() { return [c, d].join(); }, set r(x) { seen.push([c, d].join(), x); }, q1: c++, set p(x) { seen.push([c, d].join(), x); }, q2: c++, get r() { return [c, d].join(); } }; },
  "closure-stores, G0 S1 B S0 B G1"(v, c = 0) { const bump = n => (c = n); return { get p() { return (() => () => c)()(); }, set r(x) { seen.push((() => () => c)()(), x); }, q1: bump((v + 1)), set p(x) { seen.push((() => () => c)()(), x); }, q2: bump((v + 2)), get r() { return (() => () => c)()(); } }; },
  "spread-stores, G0 S1 B S0 B G1"(v) { let c; c = 0; const o = { get p() { return c; }, set r(x) { seen.push(c, x); }, ...((c = (v + 1)), { z1: 1 }), set p(x) { seen.push(c, x); }, ...((c = (v + 2)), { z2: 1 }), get r() { return c; } }; c += 100; return o; },
  "key-stores, G0 S1 B S0 B G1"(v) { let c = 0; return { get p() { return (() => c)(); }, set r(x) { seen.push((() => c)(), x); }, [((c = (v + 1)), "k1")]: 1, set p(x) { seen.push((() => c)(), x); }, [((c = (v + 2)), "k2")]: 1, get r() { return (() => c)(); } }; },
  *"yield-value, G0 S1 B S0 B G1"(v) { var c = 0; function helper() { return c; } return { get p() { return helper(); }, set r(x) { seen.push(helper(), x); }, q1: (c = yield (v + 1)), set p(x) { seen.push(helper(), x); }, q2: (c = yield (v + 2)), get r() { return helper(); } }; },
  "arguments, G0 S1 B S0 B G1"(v, c) { const d = v * 2; const o = { get p() { return [c, d].join(); }, set r(x) { seen.push([c, d].join(), x); }, q1: (arguments[1] = (v + 1)), set p(x) { seen.push([c, d].join(), x); }, q2: (arguments[1] = (v + 2)), get r() { return [c, d].join(); } }; c += 100; return o; },
  "with, G0 S1 B S0 B G1"(v) { let c; c = 0; with (scope) { return { get p() { return (() => () => c)()(); }, set r(x) { seen.push((() => () => c)()(), x); }, q1: (c = (v + 1)), set p(x) { seen.push((() => () => c)()(), x); }, q2: (c = (v + 2)), get r() { return (() => () => c)()(); } }; } },
  "store, S0 B G1 G0 B S1"(v) { let c = 0; return { set p(x) { seen.push(c, x); }, q1: (c = (v + 1)), get r() { return c; }, get p() { return c; }, q2: (c = (v + 2)), set r(x) { seen.push(c, x); } }; },
  "post, S0 B G1 G0 B S1"(v) { var c = 0; const o = { set p(x) { seen.push((() => c)(), x); }, q1: c++, get r() { return (() => c)(); }, get p() { return (() => c)(); }, q2: c++, set r(x) { seen.push((() => c)(), x); } }; c += 100; return o; },
  "closure-stores, S0 B G1 G0 B S1"(v, c = 0) { function helper() { return c; } const bump = n => (c = n); return { set p(x) { seen.push(helper(), x); }, q1: bump((v + 1)), get r() { return helper(); }, get p() { return helper(); }, q2: bump((v + 2)), set r(x) { seen.push(helper(), x); } }; },
  "spread-stores, S0 B G1 G0 B S1"(v) { let c; c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, ...((c = (v + 1)), { z1: 1 }), get r() { return [c, d].join(); }, get p() { return [c, d].join(); }, ...((c = (v + 2)), { z2: 1 }), set r(x) { seen.push([c, d].join(), x); } }; },
  "key-stores, S0 B G1 G0 B S1"(v) { let c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, [((c = (v + 1)), "k1")]: 1, get r() { return (() => () => c)()(); }, get p() { return (() => () => c)()(); }, [((c = (v + 2)), "k2")]: 1, set r(x) { seen.push((() => () => c)()(), x); } }; c += 100; return o; },
  *"yield-value, S0 B G1 G0 B S1"(v) { var c = 0; return { set p(x) { seen.push(c, x); }, q1: (c = yield (v + 1)), get r() { return c; }, get p() { return c; }, q2: (c = yield (v + 2)), set r(x) { seen.push(c, x); } }; },
  "arguments, S0 B G1 G0 B S1"(v, c) { return { set p(x) { seen.push((() => c)(), x); }, q1: (arguments[1] = (v + 1)), get r() { return (() => c)(); }, get p() { return (() => c)(); }, q2: (arguments[1] = (v + 2)), set r(x) { seen.push((() => c)(), x); } }; },
  "with, S0 B G1 G0 B S1"(v) { let c; c = 0; function helper() { return c; } with (scope) { const o = { set p(x) { seen.push(helper(), x); }, q1: (c = (v + 1)), get r() { return helper(); }, get p() { return helper(); }, q2: (c = (v + 2)), set r(x) { seen.push(helper(), x); } }; c += 100; return o; } },
  "store, S0 S1 S2 B G2 G1 G0"(v) { let c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, set s(x) { seen.push([c, d].join(), x); }, q1: (c = (v + 1)), get s() { return [c, d].join(); }, get r() { return [c, d].join(); }, get p() { return [c, d].join(); } }; },
  "post, S0 S1 S2 B G2 G1 G0"(v) { var c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, set r(x) { seen.push((() => () => c)()(), x); }, set s(x) { seen.push((() => () => c)()(), x); }, q1: c++, get s() { return (() => () => c)()(); }, get r() { return (() => () => c)()(); }, get p() { return (() => () => c)()(); } }; },
  "closure-stores, S0 S1 S2 B G2 G1 G0"(v, c = 0) { const bump = n => (c = n); const o = { set p(x) { seen.push(c, x); }, set r(x) { seen.push(c, x); }, set s(x) { seen.push(c, x); }, q1: bump((v + 1)), get s() { return c; }, get r() { return c; }, get p() { return c; } }; c += 100; return o; },
  "spread-stores, S0 S1 S2 B G2 G1 G0"(v) { let c; c = 0; return { set p(x) { seen.push((() => c)(), x); }, set r(x) { seen.push((() => c)(), x); }, set s(x) { seen.push((() => c)(), x); }, ...((c = (v + 1)), { z1: 1 }), get s() { return (() => c)(); }, get r() { return (() => c)(); }, get p() { return (() => c)(); } }; },
  "key-stores, S0 S1 S2 B G2 G1 G0"(v) { let c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, set r(x) { seen.push(helper(), x); }, set s(x) { seen.push(helper(), x); }, [((c = (v + 1)), "k1")]: 1, get s() { return helper(); }, get r() { return helper(); }, get p() { return helper(); } }; },
  *"yield-value, S0 S1 S2 B G2 G1 G0"(v) { var c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, set s(x) { seen.push([c, d].join(), x); }, q1: (c = yield (v + 1)), get s() { return [c, d].join(); }, get r() { return [c, d].join(); }, get p() { return [c, d].join(); } }; c += 100; return o; },
  "arguments, S0 S1 S2 B G2 G1 G0"(v, c) { return { set p(x) { seen.push((() => () => c)()(), x); }, set r(x) { seen.push((() => () => c)()(), x); }, set s(x) { seen.push((() => () => c)()(), x); }, q1: (arguments[1] = (v + 1)), get s() { return (() => () => c)()(); }, get r() { return (() => () => c)()(); }, get p() { return (() => () => c)()(); } }; },
  "with, S0 S1 S2 B G2 G1 G0"(v) { let c; c = 0; with (scope) { return { set p(x) { seen.push(c, x); }, set r(x) { seen.push(c, x); }, set s(x) { seen.push(c, x); }, q1: (c = (v + 1)), get s() { return c; }, get r() { return c; }, get p() { return c; } }; } },
  "store, G0 B S1 B G2 B S0 B G1 B S2"(v) { let c = 0; const o = { get p() { return (() => c)(); }, q1: (c = (v + 1)), set r(x) { seen.push((() => c)(), x); }, q2: (c = (v + 2)), get s() { return (() => c)(); }, q3: (c = (v + 3)), set p(x) { seen.push((() => c)(), x); }, q4: (c = (v + 4)), get r() { return (() => c)(); }, q5: (c = (v + 5)), set s(x) { seen.push((() => c)(), x); } }; c += 100; return o; },
  "post, G0 B S1 B G2 B S0 B G1 B S2"(v) { var c = 0; function helper() { return c; } return { get p() { return helper(); }, q1: c++, set r(x) { seen.push(helper(), x); }, q2: c++, get s() { return helper(); }, q3: c++, set p(x) { seen.push(helper(), x); }, q4: c++, get r() { return helper(); }, q5: c++, set s(x) { seen.push(helper(), x); } }; },
  "closure-stores, G0 B S1 B G2 B S0 B G1 B S2"(v, c = 0) { const d = v * 2; const bump = n => (c = n); return { get p() { return [c, d].join(); }, q1: bump((v + 1)), set r(x) { seen.push([c, d].join(), x); }, q2: bump((v + 2)), get s() { return [c, d].join(); }, q3: bump((v + 3)), set p(x) { seen.push([c, d].join(), x); }, q4: bump((v + 4)), get r() { return [c, d].join(); }, q5: bump((v + 5)), set s(x) { seen.push([c, d].join(), x); } }; },
  "spread-stores, G0 B S1 B G2 B S0 B G1 B S2"(v) { let c; c = 0; const o = { get p() { return (() => () => c)()(); }, ...((c = (v + 1)), { z1: 1 }), set r(x) { seen.push((() => () => c)()(), x); }, ...((c = (v + 2)), { z2: 1 }), get s() { return (() => () => c)()(); }, ...((c = (v + 3)), { z3: 1 }), set p(x) { seen.push((() => () => c)()(), x); }, ...((c = (v + 4)), { z4: 1 }), get r() { return (() => () => c)()(); }, ...((c = (v + 5)), { z5: 1 }), set s(x) { seen.push((() => () => c)()(), x); } }; c += 100; return o; },
  "key-stores, G0 B S1 B G2 B S0 B G1 B S2"(v) { let c = 0; return { get p() { return c; }, [((c = (v + 1)), "k1")]: 1, set r(x) { seen.push(c, x); }, [((c = (v + 2)), "k2")]: 1, get s() { return c; }, [((c = (v + 3)), "k3")]: 1, set p(x) { seen.push(c, x); }, [((c = (v + 4)), "k4")]: 1, get r() { return c; }, [((c = (v + 5)), "k5")]: 1, set s(x) { seen.push(c, x); } }; },
  *"yield-value, G0 B S1 B G2 B S0 B G1 B S2"(v) { var c = 0; return { get p() { return (() => c)(); }, q1: (c = yield (v + 1)), set r(x) { seen.push((() => c)(), x); }, q2: (c = yield (v + 2)), get s() { return (() => c)(); }, q3: (c = yield (v + 3)), set p(x) { seen.push((() => c)(), x); }, q4: (c = yield (v + 4)), get r() { return (() => c)(); }, q5: (c = yield (v + 5)), set s(x) { seen.push((() => c)(), x); } }; },
  "arguments, G0 B S1 B G2 B S0 B G1 B S2"(v, c) { function helper() { return c; } const o = { get p() { return helper(); }, q1: (arguments[1] = (v + 1)), set r(x) { seen.push(helper(), x); }, q2: (arguments[1] = (v + 2)), get s() { return helper(); }, q3: (arguments[1] = (v + 3)), set p(x) { seen.push(helper(), x); }, q4: (arguments[1] = (v + 4)), get r() { return helper(); }, q5: (arguments[1] = (v + 5)), set s(x) { seen.push(helper(), x); } }; c += 100; return o; },
  "with, G0 B S1 B G2 B S0 B G1 B S2"(v) { let c; c = 0; const d = v * 2; with (scope) { return { get p() { return [c, d].join(); }, q1: (c = (v + 1)), set r(x) { seen.push([c, d].join(), x); }, q2: (c = (v + 2)), get s() { return [c, d].join(); }, q3: (c = (v + 3)), set p(x) { seen.push([c, d].join(), x); }, q4: (c = (v + 4)), get r() { return [c, d].join(); }, q5: (c = (v + 5)), set s(x) { seen.push([c, d].join(), x); } }; } },
  "store, S0 B G1 S2 B G0 B S1 G2"(v) { let c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: (c = (v + 1)), get r() { return (() => () => c)()(); }, set s(x) { seen.push((() => () => c)()(), x); }, q2: (c = (v + 2)), get p() { return (() => () => c)()(); }, q3: (c = (v + 3)), set r(x) { seen.push((() => () => c)()(), x); }, get s() { return (() => () => c)()(); } }; },
  "post, S0 B G1 S2 B G0 B S1 G2"(v) { var c = 0; const o = { set p(x) { seen.push(c, x); }, q1: c++, get r() { return c; }, set s(x) { seen.push(c, x); }, q2: c++, get p() { return c; }, q3: c++, set r(x) { seen.push(c, x); }, get s() { return c; } }; c += 100; return o; },
  "closure-stores, S0 B G1 S2 B G0 B S1 G2"(v, c = 0) { const bump = n => (c = n); return { set p(x) { seen.push((() => c)(), x); }, q1: bump((v + 1)), get r() { return (() => c)(); }, set s(x) { seen.push((() => c)(), x); }, q2: bump((v + 2)), get p() { return (() => c)(); }, q3: bump((v + 3)), set r(x) { seen.push((() => c)(), x); }, get s() { return (() => c)(); } }; },
  "spread-stores, S0 B G1 S2 B G0 B S1 G2"(v) { let c; c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, ...((c = (v + 1)), { z1: 1 }), get r() { return helper(); }, set s(x) { seen.push(helper(), x); }, ...((c = (v + 2)), { z2: 1 }), get p() { return helper(); }, ...((c = (v + 3)), { z3: 1 }), set r(x) { seen.push(helper(), x); }, get s() { return helper(); } }; },
  "key-stores, S0 B G1 S2 B G0 B S1 G2"(v) { let c = 0; const d = v * 2; const o = { set p(x) { seen.push([c, d].join(), x); }, [((c = (v + 1)), "k1")]: 1, get r() { return [c, d].join(); }, set s(x) { seen.push([c, d].join(), x); }, [((c = (v + 2)), "k2")]: 1, get p() { return [c, d].join(); }, [((c = (v + 3)), "k3")]: 1, set r(x) { seen.push([c, d].join(), x); }, get s() { return [c, d].join(); } }; c += 100; return o; },
  *"yield-value, S0 B G1 S2 B G0 B S1 G2"(v) { var c = 0; return { set p(x) { seen.push((() => () => c)()(), x); }, q1: (c = yield (v + 1)), get r() { return (() => () => c)()(); }, set s(x) { seen.push((() => () => c)()(), x); }, q2: (c = yield (v + 2)), get p() { return (() => () => c)()(); }, q3: (c = yield (v + 3)), set r(x) { seen.push((() => () => c)()(), x); }, get s() { return (() => () => c)()(); } }; },
  "arguments, S0 B G1 S2 B G0 B S1 G2"(v, c) { return { set p(x) { seen.push(c, x); }, q1: (arguments[1] = (v + 1)), get r() { return c; }, set s(x) { seen.push(c, x); }, q2: (arguments[1] = (v + 2)), get p() { return c; }, q3: (arguments[1] = (v + 3)), set r(x) { seen.push(c, x); }, get s() { return c; } }; },
  "with, S0 B G1 S2 B G0 B S1 G2"(v) { let c; c = 0; with (scope) { const o = { set p(x) { seen.push((() => c)(), x); }, q1: (c = (v + 1)), get r() { return (() => c)(); }, set s(x) { seen.push((() => c)(), x); }, q2: (c = (v + 2)), get p() { return (() => c)(); }, q3: (c = (v + 3)), set r(x) { seen.push((() => c)(), x); }, get s() { return (() => c)(); } }; c += 100; return o; } },
  "store, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { let c = 0; function helper() { return c; } return { set p(x) { seen.push(helper(), x); }, set r(x) { seen.push(helper(), x); }, set s(x) { seen.push(helper(), x); }, set t(x) { seen.push(helper(), x); }, q1: (c = (v + 1)), get p() { return helper(); }, get r() { return helper(); }, get s() { return helper(); }, get t() { return helper(); } }; },
  "post, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { var c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, set s(x) { seen.push([c, d].join(), x); }, set t(x) { seen.push([c, d].join(), x); }, q1: c++, get p() { return [c, d].join(); }, get r() { return [c, d].join(); }, get s() { return [c, d].join(); }, get t() { return [c, d].join(); } }; },
  "closure-stores, S0 S1 S2 S3 B G0 G1 G2 G3"(v, c = 0) { const bump = n => (c = n); const o = { set p(x) { seen.push((() => () => c)()(), x); }, set r(x) { seen.push((() => () => c)()(), x); }, set s(x) { seen.push((() => () => c)()(), x); }, set t(x) { seen.push((() => () => c)()(), x); }, q1: bump((v + 1)), get p() { return (() => () => c)()(); }, get r() { return (() => () => c)()(); }, get s() { return (() => () => c)()(); }, get t() { return (() => () => c)()(); } }; c += 100; return o; },
  "spread-stores, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { let c; c = 0; return { set p(x) { seen.push(c, x); }, set r(x) { seen.push(c, x); }, set s(x) { seen.push(c, x); }, set t(x) { seen.push(c, x); }, ...((c = (v + 1)), { z1: 1 }), get p() { return c; }, get r() { return c; }, get s() { return c; }, get t() { return c; } }; },
  "key-stores, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { let c = 0; return { set p(x) { seen.push((() => c)(), x); }, set r(x) { seen.push((() => c)(), x); }, set s(x) { seen.push((() => c)(), x); }, set t(x) { seen.push((() => c)(), x); }, [((c = (v + 1)), "k1")]: 1, get p() { return (() => c)(); }, get r() { return (() => c)(); }, get s() { return (() => c)(); }, get t() { return (() => c)(); } }; },
  *"yield-value, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { var c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, set r(x) { seen.push(helper(), x); }, set s(x) { seen.push(helper(), x); }, set t(x) { seen.push(helper(), x); }, q1: (c = yield (v + 1)), get p() { return helper(); }, get r() { return helper(); }, get s() { return helper(); }, get t() { return helper(); } }; c += 100; return o; },
  "arguments, S0 S1 S2 S3 B G0 G1 G2 G3"(v, c) { const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, set r(x) { seen.push([c, d].join(), x); }, set s(x) { seen.push([c, d].join(), x); }, set t(x) { seen.push([c, d].join(), x); }, q1: (arguments[1] = (v + 1)), get p() { return [c, d].join(); }, get r() { return [c, d].join(); }, get s() { return [c, d].join(); }, get t() { return [c, d].join(); } }; },
  "with, S0 S1 S2 S3 B G0 G1 G2 G3"(v) { let c; c = 0; with (scope) { return { set p(x) { seen.push((() => () => c)()(), x); }, set r(x) { seen.push((() => () => c)()(), x); }, set s(x) { seen.push((() => () => c)()(), x); }, set t(x) { seen.push((() => () => c)()(), x); }, q1: (c = (v + 1)), get p() { return (() => () => c)()(); }, get r() { return (() => () => c)()(); }, get s() { return (() => () => c)()(); }, get t() { return (() => () => c)()(); } }; } },
  "store, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { let c = 0; const o = { get p() { return c; }, q1: (c = (v + 1)), get r() { return c; }, q2: (c = (v + 2)), get s() { return c; }, q3: (c = (v + 3)), get t() { return c; }, q4: (c = (v + 4)), set t(x) { seen.push(c, x); }, q5: (c = (v + 5)), set s(x) { seen.push(c, x); }, q6: (c = (v + 6)), set r(x) { seen.push(c, x); }, q7: (c = (v + 7)), set p(x) { seen.push(c, x); } }; c += 100; return o; },
  "post, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { var c = 0; return { get p() { return (() => c)(); }, q1: c++, get r() { return (() => c)(); }, q2: c++, get s() { return (() => c)(); }, q3: c++, get t() { return (() => c)(); }, q4: c++, set t(x) { seen.push((() => c)(), x); }, q5: c++, set s(x) { seen.push((() => c)(), x); }, q6: c++, set r(x) { seen.push((() => c)(), x); }, q7: c++, set p(x) { seen.push((() => c)(), x); } }; },
  "closure-stores, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v, c = 0) { function helper() { return c; } const bump = n => (c = n); return { get p() { return helper(); }, q1: bump((v + 1)), get r() { return helper(); }, q2: bump((v + 2)), get s() { return helper(); }, q3: bump((v + 3)), get t() { return helper(); }, q4: bump((v + 4)), set t(x) { seen.push(helper(), x); }, q5: bump((v + 5)), set s(x) { seen.push(helper(), x); }, q6: bump((v + 6)), set r(x) { seen.push(helper(), x); }, q7: bump((v + 7)), set p(x) { seen.push(helper(), x); } }; },
  "spread-stores, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { let c; c = 0; const d = v * 2; const o = { get p() { return [c, d].join(); }, ...((c = (v + 1)), { z1: 1 }), get r() { return [c, d].join(); }, ...((c = (v + 2)), { z2: 1 }), get s() { return [c, d].join(); }, ...((c = (v + 3)), { z3: 1 }), get t() { return [c, d].join(); }, ...((c = (v + 4)), { z4: 1 }), set t(x) { seen.push([c, d].join(), x); }, ...((c = (v + 5)), { z5: 1 }), set s(x) { seen.push([c, d].join(), x); }, ...((c = (v + 6)), { z6: 1 }), set r(x) { seen.push([c, d].join(), x); }, ...((c = (v + 7)), { z7: 1 }), set p(x) { seen.push([c, d].join(), x); } }; c += 100; return o; },
  "key-stores, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { let c = 0; return { get p() { return (() => () => c)()(); }, [((c = (v + 1)), "k1")]: 1, get r() { return (() => () => c)()(); }, [((c = (v + 2)), "k2")]: 1, get s() { return (() => () => c)()(); }, [((c = (v + 3)), "k3")]: 1, get t() { return (() => () => c)()(); }, [((c = (v + 4)), "k4")]: 1, set t(x) { seen.push((() => () => c)()(), x); }, [((c = (v + 5)), "k5")]: 1, set s(x) { seen.push((() => () => c)()(), x); }, [((c = (v + 6)), "k6")]: 1, set r(x) { seen.push((() => () => c)()(), x); }, [((c = (v + 7)), "k7")]: 1, set p(x) { seen.push((() => () => c)()(), x); } }; },
  *"yield-value, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { var c = 0; return { get p() { return c; }, q1: (c = yield (v + 1)), get r() { return c; }, q2: (c = yield (v + 2)), get s() { return c; }, q3: (c = yield (v + 3)), get t() { return c; }, q4: (c = yield (v + 4)), set t(x) { seen.push(c, x); }, q5: (c = yield (v + 5)), set s(x) { seen.push(c, x); }, q6: (c = yield (v + 6)), set r(x) { seen.push(c, x); }, q7: (c = yield (v + 7)), set p(x) { seen.push(c, x); } }; },
  "arguments, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v, c) { const o = { get p() { return (() => c)(); }, q1: (arguments[1] = (v + 1)), get r() { return (() => c)(); }, q2: (arguments[1] = (v + 2)), get s() { return (() => c)(); }, q3: (arguments[1] = (v + 3)), get t() { return (() => c)(); }, q4: (arguments[1] = (v + 4)), set t(x) { seen.push((() => c)(), x); }, q5: (arguments[1] = (v + 5)), set s(x) { seen.push((() => c)(), x); }, q6: (arguments[1] = (v + 6)), set r(x) { seen.push((() => c)(), x); }, q7: (arguments[1] = (v + 7)), set p(x) { seen.push((() => c)(), x); } }; c += 100; return o; },
  "with, G0 B G1 B G2 B G3 B S3 B S2 B S1 B S0"(v) { let c; c = 0; function helper() { return c; } with (scope) { return { get p() { return helper(); }, q1: (c = (v + 1)), get r() { return helper(); }, q2: (c = (v + 2)), get s() { return helper(); }, q3: (c = (v + 3)), get t() { return helper(); }, q4: (c = (v + 4)), set t(x) { seen.push(helper(), x); }, q5: (c = (v + 5)), set s(x) { seen.push(helper(), x); }, q6: (c = (v + 6)), set r(x) { seen.push(helper(), x); }, q7: (c = (v + 7)), set p(x) { seen.push(helper(), x); } }; } },
  "store, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { let c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, get r() { return [c, d].join(); }, q1: (c = (v + 1)), set s(x) { seen.push([c, d].join(), x); }, get t() { return [c, d].join(); }, q2: (c = (v + 2)), get p() { return [c, d].join(); }, set r(x) { seen.push([c, d].join(), x); }, q3: (c = (v + 3)), get s() { return [c, d].join(); }, set t(x) { seen.push([c, d].join(), x); } }; },
  "post, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { var c = 0; const o = { set p(x) { seen.push((() => () => c)()(), x); }, get r() { return (() => () => c)()(); }, q1: c++, set s(x) { seen.push((() => () => c)()(), x); }, get t() { return (() => () => c)()(); }, q2: c++, get p() { return (() => () => c)()(); }, set r(x) { seen.push((() => () => c)()(), x); }, q3: c++, get s() { return (() => () => c)()(); }, set t(x) { seen.push((() => () => c)()(), x); } }; c += 100; return o; },
  "closure-stores, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v, c = 0) { const bump = n => (c = n); return { set p(x) { seen.push(c, x); }, get r() { return c; }, q1: bump((v + 1)), set s(x) { seen.push(c, x); }, get t() { return c; }, q2: bump((v + 2)), get p() { return c; }, set r(x) { seen.push(c, x); }, q3: bump((v + 3)), get s() { return c; }, set t(x) { seen.push(c, x); } }; },
  "spread-stores, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { let c; c = 0; return { set p(x) { seen.push((() => c)(), x); }, get r() { return (() => c)(); }, ...((c = (v + 1)), { z1: 1 }), set s(x) { seen.push((() => c)(), x); }, get t() { return (() => c)(); }, ...((c = (v + 2)), { z2: 1 }), get p() { return (() => c)(); }, set r(x) { seen.push((() => c)(), x); }, ...((c = (v + 3)), { z3: 1 }), get s() { return (() => c)(); }, set t(x) { seen.push((() => c)(), x); } }; },
  "key-stores, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { let c = 0; function helper() { return c; } const o = { set p(x) { seen.push(helper(), x); }, get r() { return helper(); }, [((c = (v + 1)), "k1")]: 1, set s(x) { seen.push(helper(), x); }, get t() { return helper(); }, [((c = (v + 2)), "k2")]: 1, get p() { return helper(); }, set r(x) { seen.push(helper(), x); }, [((c = (v + 3)), "k3")]: 1, get s() { return helper(); }, set t(x) { seen.push(helper(), x); } }; c += 100; return o; },
  *"yield-value, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { var c = 0; const d = v * 2; return { set p(x) { seen.push([c, d].join(), x); }, get r() { return [c, d].join(); }, q1: (c = yield (v + 1)), set s(x) { seen.push([c, d].join(), x); }, get t() { return [c, d].join(); }, q2: (c = yield (v + 2)), get p() { return [c, d].join(); }, set r(x) { seen.push([c, d].join(), x); }, q3: (c = yield (v + 3)), get s() { return [c, d].join(); }, set t(x) { seen.push([c, d].join(), x); } }; },
  "arguments, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v, c) { return { set p(x) { seen.push((() => () => c)()(), x); }, get r() { return (() => () => c)()(); }, q1: (arguments[1] = (v + 1)), set s(x) { seen.push((() => () => c)()(), x); }, get t() { return (() => () => c)()(); }, q2: (arguments[1] = (v + 2)), get p() { return (() => () => c)()(); }, set r(x) { seen.push((() => () => c)()(), x); }, q3: (arguments[1] = (v + 3)), get s() { return (() => () => c)()(); }, set t(x) { seen.push((() => () => c)()(), x); } }; },
  "with, S0 G1 B S2 G3 B G0 S1 B G2 S3"(v) { let c; c = 0; with (scope) { const o = { set p(x) { seen.push(c, x); }, get r() { return c; }, q1: (c = (v + 1)), set s(x) { seen.push(c, x); }, get t() { return c; }, q2: (c = (v + 2)), get p() { return c; }, set r(x) { seen.push(c, x); }, q3: (c = (v + 3)), get s() { return c; }, set t(x) { seen.push(c, x); } }; c += 100; return o; } },
};
for (const [label, make] of Object.entries(makers)) {
  const said = [];
  try {
    for (let turn = 0; turn < 24; turn++) {
      let made = make(5 + turn, 0);
      if (typeof made.next === "function") {
        let step = made.next();
        while (!step.done) step = made.next(step.value);
        made = step.value;
      }
      const line = show(made, seen);
      if (turn < 2 || turn === 23) said.push(line);
    }
  } catch (error) {
    said.push("THROWS " + error.constructor.name);
  }
  console.log(label + ": " + said.join(" ;; "));
}

// GENERATED: Box tag f1
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="x"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, HasRestParameter] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="join"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="join" calleeName="values.join"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=undefined|number flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=number flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_7]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: env [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="c"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] captures=[{type=undefined|number flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] captures=[{type=number flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
