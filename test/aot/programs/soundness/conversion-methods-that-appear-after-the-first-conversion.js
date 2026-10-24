// What a conversion finds (valueOf, toString, @@toPrimitive, toJSON, @@hasInstance, @@species) changes after it has run once, in code that is reached through a chain of calls.
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

async function convertOwnValueof() {
  const o = { v: 1 };
  function install() { o.valueOf = function () { return 7; }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertOwnTostring() {
  const o = { v: 1 };
  function install() { o.toString = function () { return "late"; }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertOwnToprimitive() {
  const o = { v: 1 };
  function install() { o[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 7 : "late"; }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertProtoValueof() {
  const P = {}; const o = Object.create(P);
  function install() { P.valueOf = function () { return 7; }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertClassToprimitive() {
  class C {} const o = new C();
  function install() { C.prototype[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 7 : "late"; }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertValueofBigint() {
  const o = { valueOf() { return 1; } };
  function install() { o.valueOf = function () { return 7n; }; }
  async function use(tag) { show(tag, o * o); show(tag, -o); let x = o; x++; show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertValueofSideEffect() {
  let state = 0; const o = { v: 1 };
  function install() { o.valueOf = function () { state = "changed"; return 7; }; }
  async function use(tag) { const before = state; const r = o + 1; show(tag, before); show(tag, state); show(tag, r); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertFunctionTostring() {
  function f() {}
  function install() { f.toString = function () { return 7; }; }
  async function use(tag) { show(tag, typeof (f + 1)); show(tag, f.toString === Function.prototype.toString); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertSetPrototype() {
  const o = { v: 1 }; const T = { valueOf() { return 7; } };
  function install() { Object.setPrototypeOf(o, T); }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertGetterValueof() {
  const o = { v: 1 };
  function install() { Object.defineProperty(o, "valueOf", { get() { return () => 7; } }); }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); show(tag, `${o}`); show(tag, +o); show(tag, o < 1); show(tag, o == 1); show(tag, ({ late: 'found', 7: 'seven' })[o]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertSecondObject() {
  let o = 1;
  function install() { o = { valueOf() { return "late"; } }; }
  async function use(tag) { show(tag, o + 1); show(tag, o * 2); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertKeyLate() {
  const t = { a: 1, late: "found" }; let k = "a";
  function install() { k = { toString() { return "late"; } }; }
  async function use(tag) { show(tag, t[k]); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertBuiltinArgument() {
  const o = { v: 1 };
  function install() { o.valueOf = function () { return 7; }; }
  async function use(tag) { show(tag, Math.max(o, 1)); show(tag, Math.floor(o)); show(tag, Number(o)); show(tag, [5, 6, 7, 8, 9, 10, 11, 12].at(o)); show(tag, 'abcdefghij'.charAt(o)); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertTojsonLate() {
  const o = { v: 1 };
  function install() { o.toJSON = function () { return "late"; }; }
  async function use(tag) { show(tag, JSON.stringify(o)); show(tag, JSON.stringify({ o })); show(tag, JSON.stringify([o])); }
  await use('first');
  h0(install);
  await use('second');
}

async function convertHasinstanceLate() {
  class C {} const x = { v: 1 };
  function install() { Object.defineProperty(C, Symbol.hasInstance, { value() { return true; } }); }
  async function use(tag) { show(tag, x instanceof C); if (x instanceof C) show(tag, 'inside'); else show(tag, 'outside'); }
  await use('first');
  h0(install);
  await use('second');
}

async function builtinArgumentBecomesObject() {
  let state = 0; let o = 1;
  function install() { o = { valueOf() { state = "changed"; return 2; }, toString() { state = "string"; return "2"; } }; }
  async function use(tag) { const before = state; show(tag, Math.max(o, 1)); show(tag, state); show(tag, String(o)); show(tag, state); show(tag, parseInt(o)); show(tag, 'ab'.repeat(o)); show(tag, [1, 2, 3].join(o)); show(tag, 'abc'.indexOf(o)); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function stringifyArgumentBecomesObject() {
  let o = 1;
  function install() { o = { toJSON() { return "late"; } }; }
  async function use(tag) { show(tag, JSON.stringify(o)); show(tag, JSON.stringify([o])); show(tag, JSON.stringify({ o })); }
  await use('first');
  h0(install);
  await use('second');
}

async function stringifyNestedLate() {
  const inner = { v: 1 }; const o = { a: [{ inner }] };
  function install() { inner.toJSON = function () { return { deep: { toJSON() { return "late"; } } }; }; }
  async function use(tag) { show(tag, JSON.stringify(o)); }
  await use('first');
  h0(install);
  await use('second');
}

async function stringifyGetterLate() {
  let state = 0; const o = { v: 1 };
  function install() { Object.defineProperty(o, "w", { enumerable: true, get() { state = "changed"; return "late"; } }); }
  async function use(tag) { const before = state; show(tag, JSON.stringify(o)); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function speciesArrayConstructorLate() {
  const a = [1, 2]; class Other extends Array { tag() { return 'late'; } }
  function install() { a.constructor = Other; }
  async function use(tag) { const m = a.map(x => x); show(tag, m instanceof Other); show(tag, typeof m.tag); show(tag, a.filter(x => x).length); show(tag, a.slice(0) instanceof Other); }
  await use('first');
  h0(install);
  await use('second');
}

async function speciesArrayPlainConstructorLate() {
  let state = 0; const a = [1, 2];
  function install() { a.constructor = { [Symbol.species]: function (n) { state = "changed"; return { length: 0, made: "late" }; } }; }
  async function use(tag) { const before = state; const m = a.map(x => x); show(tag, m.made); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function hasinstanceNarrows() {
  class C { constructor() { this.a = 1; } } let x = new C();
  function install() { Object.defineProperty(C, Symbol.hasInstance, { value() { return true; } }); x = { a: 'late', b: 2 }; }
  async function use(tag) { const v = x; if (v instanceof C) { show(tag, v.a); show(tag, Object.keys(v).length); } else show(tag + ' else', v.a); }
  await use('first');
  h0(install);
  await use('second');
}

async function hasinstanceNarrowsElse() {
  class C { constructor() { this.a = 1; } } class D { constructor() { this.d = 'd'; } } let x = new D();
  function install() { Object.defineProperty(C, Symbol.hasInstance, { value() { return false; } }); x = new C(); }
  async function use(tag) { const v = x; if (v instanceof C) show(tag, v.a); else { show(tag + ' else', v.d); show(tag + ' else', v.a); } }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveSymbolKeyLate() {
  const key = { toString() { return 'a'; } }; const t = { a: 1, late: 'found' };
  function install() { key[Symbol.toPrimitive] = () => 'late'; }
  async function use(tag) { show(tag, t[key]); t[key] = 5; show(tag, Object.keys(t).length); show(tag, key in t); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveCompareLate() {
  let state = 0; const a = { v: 1 }; const b = { v: 2 };
  function install() { a.valueOf = function () { state = 'changed'; return 5; }; }
  async function use(tag) { const before = state; show(tag, a < b); show(tag, a >= 1); show(tag, a == 5); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveTemplateLate() {
  let state = 0; const o = { v: 1 };
  function install() { o.toString = function () { state = 'changed'; return 'late'; }; }
  async function use(tag) { const before = state; show(tag, `x${o}y`); show(tag, 'a' + o); show(tag, [o] + ''); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveIncrementLate() {
  let o = 1;
  function install() { o = { valueOf() { return 10n; } }; }
  async function use(tag) { let x = o; x++; show(tag, typeof x); let y = o; y = -y; show(tag, typeof y); show(tag, typeof (o * o)); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveDateArgumentLate() {
  const o = { v: 1 };
  function install() { o[Symbol.toPrimitive] = () => 86400000; }
  async function use(tag) { show(tag, new Date(o).getTime()); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveArrayIndexLate() {
  const a = ['zero', 'one']; let i = 0;
  function install() { i = { toString() { return '1'; } }; }
  async function use(tag) { show(tag, a[i]); }
  await use('first');
  h0(install);
  await use('second');
}

async function toprimitiveSortCompareLate() {
  let cmp = (a, b) => a - b;
  function install() { cmp = (a, b) => ({ valueOf() { return b - a; } }); }
  async function use(tag) { show(tag, [1, 3, 2].sort(cmp)[0]); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# convert own valueof');
  await convertOwnValueof().catch(e => print('failed', String(e)));
  print('# convert own tostring');
  await convertOwnTostring().catch(e => print('failed', String(e)));
  print('# convert own toprimitive');
  await convertOwnToprimitive().catch(e => print('failed', String(e)));
  print('# convert proto valueof');
  await convertProtoValueof().catch(e => print('failed', String(e)));
  print('# convert class toprimitive');
  await convertClassToprimitive().catch(e => print('failed', String(e)));
  print('# convert valueof bigint');
  await convertValueofBigint().catch(e => print('failed', String(e)));
  print('# convert valueof side effect');
  await convertValueofSideEffect().catch(e => print('failed', String(e)));
  print('# convert function tostring');
  await convertFunctionTostring().catch(e => print('failed', String(e)));
  print('# convert set prototype');
  await convertSetPrototype().catch(e => print('failed', String(e)));
  print('# convert getter valueof');
  await convertGetterValueof().catch(e => print('failed', String(e)));
  print('# convert second object');
  await convertSecondObject().catch(e => print('failed', String(e)));
  print('# convert key late');
  await convertKeyLate().catch(e => print('failed', String(e)));
  print('# convert builtin argument');
  await convertBuiltinArgument().catch(e => print('failed', String(e)));
  print('# convert tojson late');
  await convertTojsonLate().catch(e => print('failed', String(e)));
  print('# convert hasinstance late');
  await convertHasinstanceLate().catch(e => print('failed', String(e)));
  print('# builtin argument becomes object');
  await builtinArgumentBecomesObject().catch(e => print('failed', String(e)));
  print('# stringify argument becomes object');
  await stringifyArgumentBecomesObject().catch(e => print('failed', String(e)));
  print('# stringify nested late');
  await stringifyNestedLate().catch(e => print('failed', String(e)));
  print('# stringify getter late');
  await stringifyGetterLate().catch(e => print('failed', String(e)));
  print('# species array constructor late');
  await speciesArrayConstructorLate().catch(e => print('failed', String(e)));
  print('# species array plain constructor late');
  await speciesArrayPlainConstructorLate().catch(e => print('failed', String(e)));
  print('# hasinstance narrows');
  await hasinstanceNarrows().catch(e => print('failed', String(e)));
  print('# hasinstance narrows else');
  await hasinstanceNarrowsElse().catch(e => print('failed', String(e)));
  print('# toprimitive symbol key late');
  await toprimitiveSymbolKeyLate().catch(e => print('failed', String(e)));
  print('# toprimitive compare late');
  await toprimitiveCompareLate().catch(e => print('failed', String(e)));
  print('# toprimitive template late');
  await toprimitiveTemplateLate().catch(e => print('failed', String(e)));
  print('# toprimitive increment late');
  await toprimitiveIncrementLate().catch(e => print('failed', String(e)));
  print('# toprimitive date argument late');
  await toprimitiveDateArgumentLate().catch(e => print('failed', String(e)));
  print('# toprimitive array index late');
  await toprimitiveArrayIndexLate().catch(e => print('failed', String(e)));
  print('# toprimitive sort compare late');
  await toprimitiveSortCompareLate().catch(e => print('failed', String(e)));
}
main();
