// A value of another kind reaches a test after the test has run once, from code that is reached through a chain of calls.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function h0(f) { return h1(f); }
function h1(f) { return h2(f); }
function h2(f) { return h3(f); }
function h3(f) { return h4(f); }
function h4(f) { return h5(f); }
function h5(f) { return h6(f); }
function h6(f) { return h7(f); }
function h7(f) { return h8(f); }
function h8(f) { return f(); }

async function filterTypeofElse() {
  let x = 1;
  function install() { x = "late"; }
  async function use(tag) { const v = x; if (typeof v === 'number') show(tag, v); else show(tag + ' else', v); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterTypeofChain() {
  let x = 1;
  function install() { x = { a: 1 }; }
  async function use(tag) { const v = x; if (typeof v === 'number') show(tag, v); else if (typeof v === 'string') show(tag + ' string', v); else show(tag + ' other', v); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterNullElse() {
  let x = null;
  function install() { x = "late"; }
  async function use(tag) { const v = x; if (v === null) show(tag, v); else show(tag + ' else', v); show(tag, v ?? 5); show(tag, v?.length); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterUndefinedDefault() {
  let x;
  function install() { x = "late"; }
  async function use(tag) { const v = x; show(tag, v ?? 5); show(tag, v || 6); show(tag, v && 7); function d(a = 8) { return a; } show(tag, d(v)); const { p = 9 } = { p: v }; show(tag, p); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterInstanceofElse() {
  class A { constructor() { this.a = 1; } } class B { constructor() { this.b = "late"; } } let x = new A();
  function install() { x = new B(); }
  async function use(tag) { const v = x; if (v instanceof A) show(tag, v.a); else show(tag + ' else', v.b); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterLiteralElse() {
  let x = "a";
  function install() { x = "late"; }
  async function use(tag) { const v = x; if (v === 'a') show(tag, v); else show(tag + ' else', v); switch (v) { case 'a': show(tag, 1); break; default: show(tag + ' default', v); } }
  await use('first');
  h0(install);
  await use('second');
}

async function filterDiscriminant() {
  let x = { kind: "a", a: 1 };
  function install() { x = { kind: "b", b: "late" }; }
  async function use(tag) { const v = x; if (v.kind === 'a') show(tag, v.a); else show(tag + ' else', v.b); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterTruthy() {
  let x = 0;
  function install() { x = "late"; }
  async function use(tag) { const v = x; if (v) show(tag + ' truthy', v); else show(tag, v); show(tag, !v); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterArrayIsarray() {
  let x = [1];
  function install() { x = { length: "late" }; }
  async function use(tag) { const v = x; if (Array.isArray(v)) show(tag, v[0]); else show(tag + ' else', v.length); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterIn() {
  let x = { a: 1 };
  function install() { x = { b: "late" }; }
  async function use(tag) { const v = x; if ('a' in v) show(tag, v.a); else show(tag + ' else', v.b); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterIntegerRange() {
  let x = 1;
  function install() { x = 4000000000; }
  async function use(tag) { const v = x; if (v < 10) show(tag, v); else show(tag + ' else', v); show(tag, v | 0); show(tag, v + v); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterToObject() {
  let x = { a: 1 };
  function install() { x = "late"; }
  async function use(tag) { const v = Object(x); show(tag, typeof v); show(tag, v.length); show(tag, Object.keys(v).length); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterToObjectSymbol() {
  let x = { a: 1 };
  function install() { x = Symbol.iterator; }
  async function use(tag) { const v = Object(x); show(tag, typeof v); show(tag, typeof v.description); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterThisPrimitive() {
  let x = { a: 1 }; function who() { return typeof this; }
  function install() { x = "late"; }
  async function use(tag) { show(tag, who.call(x)); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterCreatePromisePrototype() {
  class P2 extends Promise {} let C = Promise;
  function install() { C = P2; }
  async function use(tag) { const p = C.resolve(1); show(tag, p instanceof P2); show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterConstructPrototypePrimitive() {
  function F() { this.a = 1; } F.prototype.m = function () { return 1; };
  function install() { F.prototype = 5; }
  async function use(tag) { const o = new F(); show(tag, typeof o.m); show(tag, Object.getPrototypeOf(o) === Object.prototype); }
  await use('first');
  h0(install);
  await use('second');
}

async function filterClassHeritageNull() {
  let H = Object;
  function install() { H = null; }
  async function use(tag) { const K = class extends H { static s() { return 1; } }; show(tag, Object.getPrototypeOf(K.prototype) === null); show(tag, typeof K.prototype.hasOwnProperty); }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalOptionalCallLate() {
  let f;
  function install() { f = () => 'late'; }
  async function use(tag) { show(tag, f?.()); const o = { f }; show(tag, o.f?.()); }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalNullishAssignLate() {
  let x = null;
  function install() { x = 'late'; }
  async function use(tag) { let v = x; v ??= 5; show(tag, v); let w = x; w ||= 6; show(tag, w); let u = x; u &&= 7; show(tag, u); }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalTypeofFunctionLate() {
  let x = 1;
  function install() { x = () => 'late'; }
  async function use(tag) { const v = x; show(tag, typeof v === 'function' ? v() : v); }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalSwitchTrueLate() {
  let x = 1;
  function install() { x = 'late'; }
  async function use(tag) { const v = x; switch (typeof v) { case 'number': show(tag, v); break; case 'string': show(tag + ' string', v); break; default: show(tag, 'other'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalArrayHoleLate() {
  const a = [1, 2];
  function install() { a[5] = 'late'; }
  async function use(tag) { for (const v of a) show(tag, v); show(tag, a[3]); }
  await use('first');
  h0(install);
  await use('second');
}

async function conditionalDeleteLate() {
  const o = { a: 1 };
  function install() { delete o.a; }
  async function use(tag) { show(tag, o.a); show(tag, 'a' in o); const { a = 'default' } = o; show(tag, a); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# filter typeof else');
  await filterTypeofElse().catch(e => print('failed', String(e)));
  print('# filter typeof chain');
  await filterTypeofChain().catch(e => print('failed', String(e)));
  print('# filter null else');
  await filterNullElse().catch(e => print('failed', String(e)));
  print('# filter undefined default');
  await filterUndefinedDefault().catch(e => print('failed', String(e)));
  print('# filter instanceof else');
  await filterInstanceofElse().catch(e => print('failed', String(e)));
  print('# filter literal else');
  await filterLiteralElse().catch(e => print('failed', String(e)));
  print('# filter discriminant');
  await filterDiscriminant().catch(e => print('failed', String(e)));
  print('# filter truthy');
  await filterTruthy().catch(e => print('failed', String(e)));
  print('# filter array isarray');
  await filterArrayIsarray().catch(e => print('failed', String(e)));
  print('# filter in');
  await filterIn().catch(e => print('failed', String(e)));
  print('# filter integer range');
  await filterIntegerRange().catch(e => print('failed', String(e)));
  print('# filter to object');
  await filterToObject().catch(e => print('failed', String(e)));
  print('# filter to object symbol');
  await filterToObjectSymbol().catch(e => print('failed', String(e)));
  print('# filter this primitive');
  await filterThisPrimitive().catch(e => print('failed', String(e)));
  print('# filter create promise prototype');
  await filterCreatePromisePrototype().catch(e => print('failed', String(e)));
  print('# filter construct prototype primitive');
  await filterConstructPrototypePrimitive().catch(e => print('failed', String(e)));
  print('# filter class heritage null');
  await filterClassHeritageNull().catch(e => print('failed', String(e)));
  print('# conditional optional call late');
  await conditionalOptionalCallLate().catch(e => print('failed', String(e)));
  print('# conditional nullish assign late');
  await conditionalNullishAssignLate().catch(e => print('failed', String(e)));
  print('# conditional typeof function late');
  await conditionalTypeofFunctionLate().catch(e => print('failed', String(e)));
  print('# conditional switch true late');
  await conditionalSwitchTrueLate().catch(e => print('failed', String(e)));
  print('# conditional array hole late');
  await conditionalArrayHoleLate().catch(e => print('failed', String(e)));
  print('# conditional delete late');
  await conditionalDeleteLate().catch(e => print('failed', String(e)));
}
main();
