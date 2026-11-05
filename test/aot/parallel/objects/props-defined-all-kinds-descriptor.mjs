// Object.defineProperty takes every kind of descriptor literal, each in a function of its own that runs often, on an object without the name and on one that holds undefined under it.

const log = [];
function id(x) { return x; }
function f() { return 41; }
function s(v) { log.push("s " + String(v)); }
const get = f, enumerable = true, value = 41, writable = true, yes = true;
const nameOfEnumerable = "enumerable", nameOfA = "a";
const more = { enumerable: true };
const above = { enumerable: true, writable: true };
const __proto__ = { enumerable: true };
const held = { get: f };
class Described { get = f; enumerable = true; }
class DescribedAbove { get enumerable() { return true; } }
class DescribedBelow extends DescribedAbove { value = 41; }
function describe(e) { return { get: f, enumerable: e }; }
function text(x) {
  if (typeof x === "function") return "function " + x.name;
  if (typeof x === "symbol") return x.toString();
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "object" && x !== null) return "object";
  return String(x);
}
function attempt(label, run) {
  try { console.log(label, text(run())); } catch (e) { console.log(label, "throws", e.constructor.name, e.message); }
}
function describeOwn(d) {
  if (d === undefined) return "none";
  return Object.keys(d).map(k => k + "=" + text(d[k])).join(",");
}


function look(o) {
  let d;
  try { d = describeOwn(Object.getOwnPropertyDescriptor(o, "a")); } catch (e) { d = "throws " + e.message; }
  let r; try { r = text(o.a); } catch (e) { r = "throws " + e.message; }
  let st; try { o.a = 7; st = text(o.a); } catch (e) { st = "throws " + e.message; }
  let del; try { del = delete o.a; } catch (e) { del = "throws " + e.message; }
  return d + " | " + r + " | " + Object.keys(o).join() + " | " + JSON.stringify(o) + " | " + st + " | " + del + " | " + Object.hasOwn(o, "a");
}
function run(label, make) {
  const seen = new Map();
  for (let i = 0; i < 200; i++) {
    let line;
    try { line = look(make(i & 3)); } catch (e) { line = "throws " + e.constructor.name + " " + e.message; }
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  for (const [line, times] of seen) console.log(label, times, line);
  if (log.length) console.log(label, log.length, log[0]);
  log.length = 0;
  delete held.enumerable; delete held.value; held.get = f;
}

run("nothing getter-method", function make1(i) { const o = { x: i }; Object.defineProperty(o, "a", { get() { return 41; } }); return o; });
run("nothing getter-function", function make2(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: function () { return 41; } }); return o; });
run("nothing getter-arrow", function make3(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: () => 41 }); return o; });
run("nothing getter-named", function make4(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f }); return o; });
run("nothing get-undefined", function make5(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: undefined }); return o; });
run("nothing set-undefined", function make6(i) { const o = { x: i }; Object.defineProperty(o, "a", { set: undefined }); return o; });
run("nothing get-set-undefined", function make7(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: undefined, set: undefined }); return o; });
run("nothing get-void", function make8(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: void 0, enumerable: true }); return o; });
run("nothing get-twice-last-undefined", function make9(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, get: undefined }); return o; });
run("nothing get-twice-first-undefined", function make10(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: undefined, get: f }); return o; });
run("nothing setter-only", function make11(i) { const o = { x: i }; Object.defineProperty(o, "a", { set(v) { log.push('set ' + v); } }); return o; });
run("nothing both", function make12(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, set: s }); return o; });
run("nothing both-e", function make13(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, set: s, enumerable: true }); return o; });
run("nothing both-c", function make14(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, set: s, configurable: true }); return o; });
run("nothing both-ec", function make15(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: true, configurable: true, get: f, set: s }); return o; });
run("nothing get-e", function make16(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: true, get: f }); return o; });
run("nothing get-e-false", function make17(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: false, get: f }); return o; });
run("nothing get-c", function make18(i) { const o = { x: i }; Object.defineProperty(o, "a", { configurable: true, get: f }); return o; });
run("nothing value", function make19(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41 }); return o; });
run("nothing value-w", function make20(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, writable: true }); return o; });
run("nothing value-e", function make21(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, enumerable: true }); return o; });
run("nothing value-c", function make22(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, configurable: true }); return o; });
run("nothing value-wec", function make23(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, writable: true, enumerable: true, configurable: true }); return o; });
run("nothing value-w-false", function make24(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, writable: false, enumerable: true, configurable: true }); return o; });
run("nothing value-undefined", function make25(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: undefined }); return o; });
run("nothing value-function", function make26(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: f }); return o; });
run("nothing value-method", function make27(i) { const o = { x: i }; Object.defineProperty(o, "a", { value() { return 41; } }); return o; });
run("nothing empty", function make28(i) { const o = { x: i }; Object.defineProperty(o, "a", {}); return o; });
run("nothing only-e", function make29(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: true }); return o; });
run("nothing only-e-false", function make30(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: false }); return o; });
run("nothing only-w", function make31(i) { const o = { x: i }; Object.defineProperty(o, "a", { writable: true }); return o; });
run("nothing only-w-false", function make32(i) { const o = { x: i }; Object.defineProperty(o, "a", { writable: false }); return o; });
run("nothing only-c", function make33(i) { const o = { x: i }; Object.defineProperty(o, "a", { configurable: true }); return o; });
run("nothing only-c-false", function make34(i) { const o = { x: i }; Object.defineProperty(o, "a", { configurable: false }); return o; });
run("nothing get-and-value", function make35(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, value: 41 }); return o; });
run("nothing get-and-writable", function make36(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, writable: true }); return o; });
run("nothing get-and-writable-false", function make37(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, writable: false }); return o; });
run("nothing set-and-value-undefined", function make38(i) { const o = { x: i }; Object.defineProperty(o, "a", { set: s, value: undefined }); return o; });
run("nothing get-undefined-and-value", function make39(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: undefined, value: 41 }); return o; });
run("nothing get-number", function make40(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: 1 }); return o; });
run("nothing get-null", function make41(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: null }); return o; });
run("nothing set-string", function make42(i) { const o = { x: i }; Object.defineProperty(o, "a", { set: 'x' }); return o; });
run("nothing get-object", function make43(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: {} }); return o; });
run("nothing spread-get", function make44(i) { const o = { x: i }; Object.defineProperty(o, "a", { ...{ get: f } }); return o; });
run("nothing spread-e-then-get", function make45(i) { const o = { x: i }; Object.defineProperty(o, "a", { ...{ enumerable: true }, get: f }); return o; });
run("nothing get-then-spread-e", function make46(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, ...{ enumerable: true } }); return o; });
run("nothing get-then-spread-value", function make47(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, ...{ value: 41 } }); return o; });
run("nothing value-then-spread-held", function make48(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, ...more }); return o; });
run("nothing spread-held-then-e-false", function make49(i) { const o = { x: i }; Object.defineProperty(o, "a", { ...more, value: 41, enumerable: false }); return o; });
run("nothing computed-get", function make50(i) { const o = { x: i }; Object.defineProperty(o, "a", { ['get']: f }); return o; });
run("nothing computed-joined-e", function make51(i) { const o = { x: i }; Object.defineProperty(o, "a", { ['enum' + 'erable']: true, get: f }); return o; });
run("nothing computed-held-e", function make52(i) { const o = { x: i }; Object.defineProperty(o, "a", { [nameOfEnumerable]: true, get: f }); return o; });
run("nothing computed-called-e", function make53(i) { const o = { x: i }; Object.defineProperty(o, "a", { [id('enumerable')]: true, value: 41 }); return o; });
run("nothing computed-called-get", function make54(i) { const o = { x: i }; Object.defineProperty(o, "a", { [id('get')]: f }); return o; });
run("nothing computed-called-get-and-value", function make55(i) { const o = { x: i }; Object.defineProperty(o, "a", { [id('get')]: f, value: 41 }); return o; });
run("nothing proto-get", function make56(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { get: f } }); return o; });
run("nothing proto-e-get", function make57(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { enumerable: true }, get: f }); return o; });
run("nothing proto-e-value", function make58(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { enumerable: true }, value: 41 }); return o; });
run("nothing proto-w-value", function make59(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { writable: true }, value: 41 }); return o; });
run("nothing proto-c-get", function make60(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { configurable: true }, get: f }); return o; });
run("nothing proto-value", function make61(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { value: 41 } }); return o; });
run("nothing proto-value-own-get", function make62(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: { value: 41 }, get: f }); return o; });
run("nothing proto-null-value", function make63(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: null, value: 41 }); return o; });
run("nothing proto-held", function make64(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__: above, value: 41 }); return o; });
run("nothing proto-computed", function make65(i) { const o = { x: i }; Object.defineProperty(o, "a", { ['__proto__']: { enumerable: true }, value: 41 }); return o; });
run("nothing proto-shorthand", function make66(i) { const o = { x: i }; Object.defineProperty(o, "a", { __proto__, value: 41 }); return o; });
run("nothing e-one", function make67(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: 1, get: f }); return o; });
run("nothing e-zero", function make68(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: 0, get: f }); return o; });
run("nothing e-empty-string", function make69(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: '', value: 41 }); return o; });
run("nothing e-string", function make70(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: 'no', value: 41 }); return o; });
run("nothing e-undefined", function make71(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: undefined, get: f }); return o; });
run("nothing e-null", function make72(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: null, value: 41 }); return o; });
run("nothing e-nan", function make73(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: NaN, value: 41 }); return o; });
run("nothing e-object", function make74(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: {}, get: f }); return o; });
run("nothing e-bigint-zero", function make75(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: 0n, get: f }); return o; });
run("nothing e-bigint", function make76(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: 1n, value: 41 }); return o; });
run("nothing e-symbol", function make77(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: Symbol.iterator, value: 41 }); return o; });
run("nothing e-method", function make78(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable() {}, value: 41 }); return o; });
run("nothing w-one", function make79(i) { const o = { x: i }; Object.defineProperty(o, "a", { writable: 1, value: 41 }); return o; });
run("nothing w-method", function make80(i) { const o = { x: i }; Object.defineProperty(o, "a", { writable() {}, value: 41 }); return o; });
run("nothing c-list", function make81(i) { const o = { x: i }; Object.defineProperty(o, "a", { configurable: [], get: f }); return o; });
run("nothing e-twice-last-false", function make82(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: true, enumerable: false, get: f }); return o; });
run("nothing e-twice-last-true", function make83(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: false, value: 41, enumerable: true }); return o; });
run("nothing e-called", function make84(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: id(true), get: f }); return o; });
run("nothing e-called-false", function make85(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: id(false), value: 41 }); return o; });
run("nothing e-held-true", function make86(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: yes, get: f }); return o; });
run("nothing e-not", function make87(i) { const o = { x: i }; Object.defineProperty(o, "a", { enumerable: !0, configurable: !1, get: f }); return o; });
run("nothing accessor-e", function make88(i) { const o = { x: i }; Object.defineProperty(o, "a", { get enumerable() { log.push('read enumerable'); return true; }, value: 41 }); return o; });
run("nothing accessor-get", function make89(i) { const o = { x: i }; Object.defineProperty(o, "a", { get get() { log.push('read get'); return f; } }); return o; });
run("nothing accessor-value", function make90(i) { const o = { x: i }; Object.defineProperty(o, "a", { get value() { log.push('read value'); return 41; } }); return o; });
run("nothing accessor-value-and-get", function make91(i) { const o = { x: i }; Object.defineProperty(o, "a", { get value() { return 41; }, get: f }); return o; });
run("nothing setter-e", function make92(i) { const o = { x: i }; Object.defineProperty(o, "a", { set enumerable(v) {}, value: 41 }); return o; });
run("nothing setter-get", function make93(i) { const o = { x: i }; Object.defineProperty(o, "a", { set get(v) {} }); return o; });
run("nothing shorthand-get", function make94(i) { const o = { x: i }; Object.defineProperty(o, "a", { get }); return o; });
run("nothing shorthand-get-e", function make95(i) { const o = { x: i }; Object.defineProperty(o, "a", { get, enumerable }); return o; });
run("nothing shorthand-value", function make96(i) { const o = { x: i }; Object.defineProperty(o, "a", { value, writable }); return o; });
run("nothing other-names", function make97(i) { const o = { x: i }; Object.defineProperty(o, "a", { value: 41, extra: 1, Enumerable: true }); return o; });
run("nothing condition-whole", function make98(i) { const o = { x: i }; Object.defineProperty(o, "a", (id(true) ? { get: f } : { value: 41 })); return o; });
run("nothing condition-whole-other", function make99(i) { const o = { x: i }; Object.defineProperty(o, "a", (id(false) ? { get: f } : { value: 41, enumerable: true })); return o; });
run("nothing condition-e", function make100(i) { const o = { x: i }; Object.defineProperty(o, "a", (id(true) ? { get: f, enumerable: true } : { get: f, enumerable: false })); return o; });
run("nothing condition-member", function make101(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, enumerable: id(1) > 0 }); return o; });
run("nothing condition-getter", function make102(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: id(true) ? f : undefined, enumerable: true }); return o; });
run("nothing condition-getter-none", function make103(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: id(false) ? f : undefined, enumerable: true }); return o; });
run("nothing held", function make104(i) { const o = { x: i }; Object.defineProperty(o, "a", held); return o; });
run("nothing held-changed", function make105(i) { const o = { x: i }; Object.defineProperty(o, "a", (held.enumerable = true, held)); return o; });
run("nothing held-deleted", function make106(i) { const o = { x: i }; Object.defineProperty(o, "a", (delete held.get, held.value = 41, held)); return o; });
run("nothing frozen", function make107(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.freeze({ get: f, enumerable: true })); return o; });
run("nothing instance", function make108(i) { const o = { x: i }; Object.defineProperty(o, "a", new Described()); return o; });
run("nothing instance-below", function make109(i) { const o = { x: i }; Object.defineProperty(o, "a", new DescribedBelow()); return o; });
run("nothing made-by-function", function make110(i) { const o = { x: i }; Object.defineProperty(o, "a", describe(true)); return o; });
run("nothing assigned", function make111(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.assign({ get: f }, { enumerable: true })); return o; });
run("nothing created", function make112(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.create({ get: f, enumerable: true })); return o; });
run("nothing function-object", function make113(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.assign(function () {}, { value: 41, enumerable: true })); return o; });
run("nothing list", function make114(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.assign([], { value: 41 })); return o; });
run("nothing read-back", function make115(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.getOwnPropertyDescriptor({ get a() { return 41; } }, 'a')); return o; });
run("nothing read-back-value", function make116(i) { const o = { x: i }; Object.defineProperty(o, "a", Object.getOwnPropertyDescriptor({ a: 41 }, 'a')); return o; });
run("nothing number", function make117(i) { const o = { x: i }; Object.defineProperty(o, "a", 1); return o; });
run("nothing undefined", function make118(i) { const o = { x: i }; Object.defineProperty(o, "a", undefined); return o; });
run("nothing null", function make119(i) { const o = { x: i }; Object.defineProperty(o, "a", null); return o; });
run("nothing string", function make120(i) { const o = { x: i }; Object.defineProperty(o, "a", 'get'); return o; });
run("nothing as-const-ts", function make121(i) { const o = { x: i }; Object.defineProperty(o, "a", { get: f, enumerable: true }); return o; });
run("undefined getter-method", function make122(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get() { return 41; } }); return o; });
run("undefined getter-function", function make123(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: function () { return 41; } }); return o; });
run("undefined getter-arrow", function make124(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: () => 41 }); return o; });
run("undefined getter-named", function make125(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f }); return o; });
run("undefined get-undefined", function make126(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: undefined }); return o; });
run("undefined set-undefined", function make127(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set: undefined }); return o; });
run("undefined get-set-undefined", function make128(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: undefined, set: undefined }); return o; });
run("undefined get-void", function make129(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: void 0, enumerable: true }); return o; });
run("undefined get-twice-last-undefined", function make130(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, get: undefined }); return o; });
run("undefined get-twice-first-undefined", function make131(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: undefined, get: f }); return o; });
run("undefined setter-only", function make132(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set(v) { log.push('set ' + v); } }); return o; });
run("undefined both", function make133(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, set: s }); return o; });
run("undefined both-e", function make134(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, set: s, enumerable: true }); return o; });
run("undefined both-c", function make135(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, set: s, configurable: true }); return o; });
run("undefined both-ec", function make136(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: true, configurable: true, get: f, set: s }); return o; });
run("undefined get-e", function make137(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: true, get: f }); return o; });
run("undefined get-e-false", function make138(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: false, get: f }); return o; });
run("undefined get-c", function make139(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { configurable: true, get: f }); return o; });
run("undefined value", function make140(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41 }); return o; });
run("undefined value-w", function make141(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, writable: true }); return o; });
run("undefined value-e", function make142(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, enumerable: true }); return o; });
run("undefined value-c", function make143(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, configurable: true }); return o; });
run("undefined value-wec", function make144(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, writable: true, enumerable: true, configurable: true }); return o; });
run("undefined value-w-false", function make145(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, writable: false, enumerable: true, configurable: true }); return o; });
run("undefined value-undefined", function make146(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: undefined }); return o; });
run("undefined value-function", function make147(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: f }); return o; });
run("undefined value-method", function make148(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value() { return 41; } }); return o; });
run("undefined empty", function make149(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", {}); return o; });
run("undefined only-e", function make150(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: true }); return o; });
run("undefined only-e-false", function make151(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: false }); return o; });
run("undefined only-w", function make152(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { writable: true }); return o; });
run("undefined only-w-false", function make153(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { writable: false }); return o; });
run("undefined only-c", function make154(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { configurable: true }); return o; });
run("undefined only-c-false", function make155(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { configurable: false }); return o; });
run("undefined get-and-value", function make156(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, value: 41 }); return o; });
run("undefined get-and-writable", function make157(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, writable: true }); return o; });
run("undefined get-and-writable-false", function make158(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, writable: false }); return o; });
run("undefined set-and-value-undefined", function make159(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set: s, value: undefined }); return o; });
run("undefined get-undefined-and-value", function make160(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: undefined, value: 41 }); return o; });
run("undefined get-number", function make161(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: 1 }); return o; });
run("undefined get-null", function make162(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: null }); return o; });
run("undefined set-string", function make163(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set: 'x' }); return o; });
run("undefined get-object", function make164(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: {} }); return o; });
run("undefined spread-get", function make165(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ...{ get: f } }); return o; });
run("undefined spread-e-then-get", function make166(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ...{ enumerable: true }, get: f }); return o; });
run("undefined get-then-spread-e", function make167(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, ...{ enumerable: true } }); return o; });
run("undefined get-then-spread-value", function make168(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, ...{ value: 41 } }); return o; });
run("undefined value-then-spread-held", function make169(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, ...more }); return o; });
run("undefined spread-held-then-e-false", function make170(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ...more, value: 41, enumerable: false }); return o; });
run("undefined computed-get", function make171(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ['get']: f }); return o; });
run("undefined computed-joined-e", function make172(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ['enum' + 'erable']: true, get: f }); return o; });
run("undefined computed-held-e", function make173(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { [nameOfEnumerable]: true, get: f }); return o; });
run("undefined computed-called-e", function make174(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { [id('enumerable')]: true, value: 41 }); return o; });
run("undefined computed-called-get", function make175(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { [id('get')]: f }); return o; });
run("undefined computed-called-get-and-value", function make176(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { [id('get')]: f, value: 41 }); return o; });
run("undefined proto-get", function make177(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { get: f } }); return o; });
run("undefined proto-e-get", function make178(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { enumerable: true }, get: f }); return o; });
run("undefined proto-e-value", function make179(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { enumerable: true }, value: 41 }); return o; });
run("undefined proto-w-value", function make180(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { writable: true }, value: 41 }); return o; });
run("undefined proto-c-get", function make181(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { configurable: true }, get: f }); return o; });
run("undefined proto-value", function make182(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { value: 41 } }); return o; });
run("undefined proto-value-own-get", function make183(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: { value: 41 }, get: f }); return o; });
run("undefined proto-null-value", function make184(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: null, value: 41 }); return o; });
run("undefined proto-held", function make185(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__: above, value: 41 }); return o; });
run("undefined proto-computed", function make186(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { ['__proto__']: { enumerable: true }, value: 41 }); return o; });
run("undefined proto-shorthand", function make187(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { __proto__, value: 41 }); return o; });
run("undefined e-one", function make188(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: 1, get: f }); return o; });
run("undefined e-zero", function make189(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: 0, get: f }); return o; });
run("undefined e-empty-string", function make190(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: '', value: 41 }); return o; });
run("undefined e-string", function make191(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: 'no', value: 41 }); return o; });
run("undefined e-undefined", function make192(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: undefined, get: f }); return o; });
run("undefined e-null", function make193(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: null, value: 41 }); return o; });
run("undefined e-nan", function make194(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: NaN, value: 41 }); return o; });
run("undefined e-object", function make195(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: {}, get: f }); return o; });
run("undefined e-bigint-zero", function make196(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: 0n, get: f }); return o; });
run("undefined e-bigint", function make197(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: 1n, value: 41 }); return o; });
run("undefined e-symbol", function make198(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: Symbol.iterator, value: 41 }); return o; });
run("undefined e-method", function make199(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable() {}, value: 41 }); return o; });
run("undefined w-one", function make200(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { writable: 1, value: 41 }); return o; });
run("undefined w-method", function make201(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { writable() {}, value: 41 }); return o; });
run("undefined c-list", function make202(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { configurable: [], get: f }); return o; });
run("undefined e-twice-last-false", function make203(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: true, enumerable: false, get: f }); return o; });
run("undefined e-twice-last-true", function make204(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: false, value: 41, enumerable: true }); return o; });
run("undefined e-called", function make205(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: id(true), get: f }); return o; });
run("undefined e-called-false", function make206(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: id(false), value: 41 }); return o; });
run("undefined e-held-true", function make207(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: yes, get: f }); return o; });
run("undefined e-not", function make208(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { enumerable: !0, configurable: !1, get: f }); return o; });
run("undefined accessor-e", function make209(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get enumerable() { log.push('read enumerable'); return true; }, value: 41 }); return o; });
run("undefined accessor-get", function make210(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get get() { log.push('read get'); return f; } }); return o; });
run("undefined accessor-value", function make211(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get value() { log.push('read value'); return 41; } }); return o; });
run("undefined accessor-value-and-get", function make212(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get value() { return 41; }, get: f }); return o; });
run("undefined setter-e", function make213(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set enumerable(v) {}, value: 41 }); return o; });
run("undefined setter-get", function make214(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { set get(v) {} }); return o; });
run("undefined shorthand-get", function make215(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get }); return o; });
run("undefined shorthand-get-e", function make216(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get, enumerable }); return o; });
run("undefined shorthand-value", function make217(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value, writable }); return o; });
run("undefined other-names", function make218(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { value: 41, extra: 1, Enumerable: true }); return o; });
run("undefined condition-whole", function make219(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", (id(true) ? { get: f } : { value: 41 })); return o; });
run("undefined condition-whole-other", function make220(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", (id(false) ? { get: f } : { value: 41, enumerable: true })); return o; });
run("undefined condition-e", function make221(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", (id(true) ? { get: f, enumerable: true } : { get: f, enumerable: false })); return o; });
run("undefined condition-member", function make222(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, enumerable: id(1) > 0 }); return o; });
run("undefined condition-getter", function make223(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: id(true) ? f : undefined, enumerable: true }); return o; });
run("undefined condition-getter-none", function make224(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: id(false) ? f : undefined, enumerable: true }); return o; });
run("undefined held", function make225(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", held); return o; });
run("undefined held-changed", function make226(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", (held.enumerable = true, held)); return o; });
run("undefined held-deleted", function make227(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", (delete held.get, held.value = 41, held)); return o; });
run("undefined frozen", function make228(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.freeze({ get: f, enumerable: true })); return o; });
run("undefined instance", function make229(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", new Described()); return o; });
run("undefined instance-below", function make230(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", new DescribedBelow()); return o; });
run("undefined made-by-function", function make231(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", describe(true)); return o; });
run("undefined assigned", function make232(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.assign({ get: f }, { enumerable: true })); return o; });
run("undefined created", function make233(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.create({ get: f, enumerable: true })); return o; });
run("undefined function-object", function make234(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.assign(function () {}, { value: 41, enumerable: true })); return o; });
run("undefined list", function make235(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.assign([], { value: 41 })); return o; });
run("undefined read-back", function make236(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.getOwnPropertyDescriptor({ get a() { return 41; } }, 'a')); return o; });
run("undefined read-back-value", function make237(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", Object.getOwnPropertyDescriptor({ a: 41 }, 'a')); return o; });
run("undefined number", function make238(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", 1); return o; });
run("undefined undefined", function make239(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", undefined); return o; });
run("undefined null", function make240(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", null); return o; });
run("undefined string", function make241(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", 'get'); return o; });
run("undefined as-const-ts", function make242(i) { const o = {}; o.a = undefined; Object.defineProperty(o, "a", { get: f, enumerable: true }); return o; });
