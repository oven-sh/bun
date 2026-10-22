// A member that a built-in reads or calls by name (join, exec, set, add, resolve, then, length, @@toStringTag ..) appears after the built-in has run once, in code that is reached through a chain of calls.
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

async function namedArrayOwnJoin() {
  let state = 0; const a = [1, 2];
  function install() { a.join = function () { state = "changed"; return "late"; }; }
  async function use(tag) { show(tag, String(a)); show(tag, `${a}`); show(tag, a + ''); show(tag, [a, 3] + '');show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedRegexpOwnExec() {
  let state = 0; const re = /a/;
  function install() { re.exec = function (s) { state = "changed"; return null; }; }
  async function use(tag) { show(tag, re.test('a')); show(tag, 'a'.replace(re, 'b')); show(tag, 'a'.match(re) === null); show(tag, 'a'.search(re)); show(tag, 'bab'.split(re).length);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedTostringtagGetter() {
  let state = 0; const o = { v: 1 };
  function install() { Object.defineProperty(o, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } }); }
  async function use(tag) { show(tag, `${o}`); show(tag, Object.prototype.toString.call(o)); show(tag, o + '');show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedTostringtagOnClass() {
  let state = 0; class C {} const o = new C();
  function install() { Object.defineProperty(C.prototype, Symbol.toStringTag, { get() { state = "changed"; return "Late"; } }); }
  async function use(tag) { show(tag, `${o}`); show(tag, String(o));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedErrorNameGetter() {
  let state = 0; const e = new Error('m');
  function install() { Object.defineProperty(e, "name", { get() { state = "changed"; return "Late"; } }); }
  async function use(tag) { show(tag, String(e)); show(tag, `${e}`); show(tag, e + '');show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedErrorMessageObject() {
  let state = 0; const e = new Error('m');
  function install() { e.message = { toString() { state = "changed"; return "late"; } }; }
  async function use(tag) { show(tag, String(e));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedMapSubclassSet() {
  let state = 0; class M extends Map {}
  function install() { M.prototype.set = function (k, v) { state = "changed"; return Map.prototype.set.call(this, k, "late"); }; }
  async function use(tag) { const m = new M([[1, 2]]); show(tag, m.get(1));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedSetSubclassAdd() {
  let state = 0; class Z extends Set {}
  function install() { Z.prototype.add = function (v) { state = "changed"; return Set.prototype.add.call(this, "late"); }; }
  async function use(tag) { const z = new Z([1]); show(tag, [...z][0]);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedPromiseSubclassResolve() {
  let state = 0; class P extends Promise {}
  function install() { P.resolve = function (v) { state = "changed"; return Promise.resolve("late"); }; }
  async function use(tag) { show(tag, (await P.all([1]))[0]); show(tag, await P.race([1])); show(tag, (await P.allSettled([1]))[0].value); show(tag, await P.any([1]));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedPromiseOwnThenForCatch() {
  let state = 0; const p = Promise.resolve(1);
  function install() { p.then = function (a, b) { state = "changed"; return Promise.resolve("late"); }; }
  async function use(tag) { show(tag, await p.catch(() => 0)); show(tag, await p.finally(() => {}));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedDateOwnMethods() {
  let state = 0; const d = new Date(0);
  function install() { d.valueOf = () => { state = "changed"; return 7; }; d.toString = () => "late"; d.toISOString = () => "iso"; }
  async function use(tag) { show(tag, d - 0); show(tag, typeof (d + '')); show(tag, (d + '').length < 6); show(tag, JSON.stringify(d).length < 8);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedWrapperOwnValueof() {
  let state = 0; const n = new Number(1); const s = new String('s');
  function install() { n.valueOf = () => { state = "changed"; return "late"; }; s.toString = () => "late"; }
  async function use(tag) { show(tag, n + 1); show(tag, `${s}`); show(tag, JSON.stringify([n, s]));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedSpeciesStaticGetter() {
  let state = 0; class L extends Array {}
  function install() { Object.defineProperty(L, Symbol.species, { get() { state = "changed"; return Array; } }); }
  async function use(tag) { const l = L.from([1]); show(tag, l.map(x => x) instanceof L); show(tag, l.filter(x => x) instanceof L); show(tag, l.slice() instanceof L);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedArrayLikeIndexGetter() {
  let state = 0; const al = { length: 1, 0: 1 };
  function install() { Object.defineProperty(al, "0", { get() { state = "changed"; return "late"; } }); }
  async function use(tag) { show(tag, Array.prototype.map.call(al, x => x)[0]); show(tag, Array.from(al)[0]); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.indexOf.call(al, 'late')); show(tag, Math.max.apply(null, al));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedArrayLikeLengthGetter() {
  let state = 0; const al = { length: 1, 0: 1, 1: 'late' };
  function install() { Object.defineProperty(al, "length", { get() { state = "changed"; return 2; } }); }
  async function use(tag) { show(tag, Array.from(al).length); show(tag, Array.prototype.slice.call(al)[1]); show(tag, Array.prototype.at.call(al, -1));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedArrayLikeLengthObject() {
  let state = 0; const al = { length: 1, 0: 'x' };
  function install() { al.length = { valueOf() { state = "changed"; return 0; } }; }
  async function use(tag) { show(tag, Array.from(al).length); show(tag, Array.prototype.join.call(al)); show(tag, Array.prototype.includes.call(al, 'x'));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedMatchSymbol() {
  let state = 0; const o = { toString() { return 'a'; } };
  function install() { o[Symbol.match] = function (s) { state = "changed"; return "late"; }; o[Symbol.replace] = function () { return "late"; }; o[Symbol.search] = function () { return "late"; }; o[Symbol.split] = function () { return "late"; }; }
  async function use(tag) { show(tag, 'abc'.match(o) + ''); show(tag, 'abc'.replace(o, 'x')); show(tag, 'abc'.search(o)); show(tag, 'abc'.split(o) + '');show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedReplacementResultConverted() {
  let state = 0; const o = { v: 1 };
  function install() { o.toString = function () { state = "changed"; return "late"; }; }
  async function use(tag) { show(tag, 'a'.replace('a', () => o)); show(tag, 'a'.replace(/a/, () => o)); show(tag, 'a'.replaceAll('a', () => o));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedElementTostring() {
  let state = 0; const o = { v: 1 };
  function install() { o.toString = function () { state = "changed"; return "late"; }; o.toLocaleString = function () { return "local"; }; }
  async function use(tag) { show(tag, [o].join()); show(tag, [[o]] + ''); show(tag, [o].toLocaleString()); show(tag, String([o, [o]]));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedBindReadsName() {
  let state = 0; function f(a, b) {}
  function install() { Object.defineProperty(f, "name", { get() { state = "changed"; return "late"; } }); Object.defineProperty(f, "length", { get() { return 7; } }); }
  async function use(tag) { const b = f.bind(null); show(tag, b.name); show(tag, b.length);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedAssignSetter() {
  let state = 0; const target = { a: 1 };
  function install() { Object.defineProperty(target, "a", { set(v) { state = "changed"; }, get() { return "late"; } }); }
  async function use(tag) { Object.assign(target, { a: 2 }); show(tag, target.a); const copy = { ...target }; show(tag, copy.a);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedDescriptorGetters() {
  let state = 0; const d = { value: 1, enumerable: true };
  function install() { Object.defineProperty(d, "value", { get() { state = "changed"; return "late"; } }); }
  async function use(tag) { const o = Object.defineProperty({}, 'x', d); show(tag, o.x); show(tag, Object.create(null, { y: d }).y);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedInspectCustom() {
  let state = 0; const o = { v: 1 };
  function install() { o[Symbol.for("nodejs.util.inspect.custom")] = function () { state = "changed"; return "late"; }; }
  async function use(tag) { console.log(o);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedStringifyReplacerArray() {
  let state = 0; const keys = ['a']; const o = { a: 1, late: 2 };
  function install() { keys.push({ toString() { state = "changed"; return "late"; } }); }
  async function use(tag) { show(tag, JSON.stringify(o, keys));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedParseReviver() {
  let state = 0; let reviver = (k, v) => v;
  function install() { reviver = function (k, v) { state = "changed"; return typeof v === "number" ? "late" : v; }; }
  async function use(tag) { show(tag, JSON.parse('{"a":1}', reviver).a);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedIteratorHelperNext() {
  let state = 0; let n = 0; const it = { next() { return { done: n++ > 0, value: 1 }; } };
  function install() { it.next = function () { state = "changed"; return { done: n++ > 0, value: "late" }; }; }
  async function use(tag) { n = 0; show(tag, Iterator.from(it).toArray()[0]); n = 0; show(tag, Iterator.from(it).map(x => x).next().value);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedSetLike() {
  let state = 0; const like = { size: 1, has() { return false; }, keys() { return [1][Symbol.iterator](); } };
  function install() { like.keys = function () { state = "changed"; return ["late"][Symbol.iterator](); }; }
  async function use(tag) { show(tag, [...new Set([0]).union(like)][1]);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedConstructorForFrom() {
  let state = 0; let C = Array;
  function install() { C = function (n) { state = "changed"; this.made = "late"; }; }
  async function use(tag) { const r = Array.from.call(C, [1]); show(tag, r.made); show(tag, Array.of.call(C, 1).made);show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function namedTojsonOnClass() {
  let state = 0; class K { constructor() { this.v = 1; } } const k = new K();
  function install() { K.prototype.toJSON = function () { state = "changed"; return "late"; }; }
  async function use(tag) { show(tag, JSON.stringify(k)); show(tag, JSON.stringify({ k })); show(tag, JSON.stringify(new Map([[1, k]]).get(1)));show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# named array own join');
  await namedArrayOwnJoin().catch(e => print('failed', String(e)));
  print('# named regexp own exec');
  await namedRegexpOwnExec().catch(e => print('failed', String(e)));
  print('# named tostringtag getter');
  await namedTostringtagGetter().catch(e => print('failed', String(e)));
  print('# named tostringtag on class');
  await namedTostringtagOnClass().catch(e => print('failed', String(e)));
  print('# named error name getter');
  await namedErrorNameGetter().catch(e => print('failed', String(e)));
  print('# named error message object');
  await namedErrorMessageObject().catch(e => print('failed', String(e)));
  print('# named map subclass set');
  await namedMapSubclassSet().catch(e => print('failed', String(e)));
  print('# named set subclass add');
  await namedSetSubclassAdd().catch(e => print('failed', String(e)));
  print('# named promise subclass resolve');
  await namedPromiseSubclassResolve().catch(e => print('failed', String(e)));
  print('# named promise own then for catch');
  await namedPromiseOwnThenForCatch().catch(e => print('failed', String(e)));
  print('# named date own methods');
  await namedDateOwnMethods().catch(e => print('failed', String(e)));
  print('# named wrapper own valueof');
  await namedWrapperOwnValueof().catch(e => print('failed', String(e)));
  print('# named species static getter');
  await namedSpeciesStaticGetter().catch(e => print('failed', String(e)));
  print('# named array like index getter');
  await namedArrayLikeIndexGetter().catch(e => print('failed', String(e)));
  print('# named array like length getter');
  await namedArrayLikeLengthGetter().catch(e => print('failed', String(e)));
  print('# named array like length object');
  await namedArrayLikeLengthObject().catch(e => print('failed', String(e)));
  print('# named match symbol');
  await namedMatchSymbol().catch(e => print('failed', String(e)));
  print('# named replacement result converted');
  await namedReplacementResultConverted().catch(e => print('failed', String(e)));
  print('# named element tostring');
  await namedElementTostring().catch(e => print('failed', String(e)));
  print('# named bind reads name');
  await namedBindReadsName().catch(e => print('failed', String(e)));
  print('# named assign setter');
  await namedAssignSetter().catch(e => print('failed', String(e)));
  print('# named descriptor getters');
  await namedDescriptorGetters().catch(e => print('failed', String(e)));
  print('# named inspect custom');
  await namedInspectCustom().catch(e => print('failed', String(e)));
  print('# named stringify replacer array');
  await namedStringifyReplacerArray().catch(e => print('failed', String(e)));
  print('# named parse reviver');
  await namedParseReviver().catch(e => print('failed', String(e)));
  print('# named iterator helper next');
  await namedIteratorHelperNext().catch(e => print('failed', String(e)));
  print('# named set like');
  await namedSetLike().catch(e => print('failed', String(e)));
  print('# named constructor for from');
  await namedConstructorForFrom().catch(e => print('failed', String(e)));
  print('# named tojson on class');
  await namedTojsonOnClass().catch(e => print('failed', String(e)));
}
main();
