// What a loop, a pattern or a spread finds (@@iterator, next, return, the results, the contents) changes after it has run once, in a function that is found under a key read from a field before the constructor stores it.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
function nothing() {}
let leaked = "a";
function probe(x) { leaked = x.k; }
class Leak { constructor() { probe(this); this.k = "a"; } }
function h0(f) { const choices = { a: nothing, undefined: f }; new Leak(); return choices[leaked](); }

async function iterateOwnIterator() {
  const o = { v: 1 };
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateProtoIterator() {
  const P = {}; const o = Object.create(P);
  function install() { P[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateIteratorReplaced() {
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } }; } };
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateNextReplaced() {
  let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };
  function install() { it.next = function () { return { done: i++ >= 2, value: "late" }; }; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateNextOnProto() {
  let i = 0; const IP = { next() { return { done: i++ >= 2, value: 1 }; } }; const it = Object.create(IP); const o = { [Symbol.iterator]() { i = 0; return it; } };
  function install() { it.next = function () { return { done: i++ >= 2, value: "late" }; }; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateReturnAppears() {
  let i = 0; let closed = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } };
  function install() { it.return = function () { closed = "closed"; return {}; }; }
  async function use(tag) { for (const x of o) { show(tag, x); break; } show(tag, closed); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateArrayOwnIterator() {
  const a = [1, 2];
  function install() { a[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { for (const x of a) show(tag, x); const [p, q] = a; show(tag, p); show(tag, [...a][0]); show(tag, Array.from(a)[0]); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateArrayValuesResultOwnNext() {
  const a = [1, 2]; const it = a.values();
  function install() { let n = 0; it.next = function () { return { done: n++ >= 2, value: "late" }; }; }
  async function use(tag) { if (tag === 'first') { show(tag, 0); return; } for (const x of it) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateResultValueLate() {
  let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };
  function install() { r.value = "late"; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateResultValueGetter() {
  let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };
  function install() { Object.defineProperty(r, "value", { get() { return "late"; } }); }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateResultValueOnProto() {
  let i = 0; const RP = {}; const o = { [Symbol.iterator]() { i = 0; return { next() { const r = Object.create(RP); r.done = i++ >= 2; return r; } }; } };
  function install() { RP.value = "late"; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateResultDoneGetter() {
  let i = 0; let seen = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { i++; return r; } }; } };
  function install() { Object.defineProperty(r, "done", { get() { seen = "getter"; return i > 2; } }); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); return; } for (const x of o) show(tag, x); show(tag, seen); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateSecondResultObject() {
  let i = 0; let late = false; function other() { return { done: i++ >= 2, value: "late" }; } const o = { [Symbol.iterator]() { i = 0; return { next() { return late ? other() : { done: i++ >= 2, value: 1 }; } }; } };
  function install() { late = true; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateSecondIterable() {
  let x = [1, 2];
  function install() { x = new Set(["late"]); }
  async function use(tag) { for (const v of x) show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateThirdIterable() {
  let x = [1, 2];
  function install() { x = "ab"; }
  async function use(tag) { for (const v of x) show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateElementsLate() {
  const a = [1, 2];
  function install() { a.push("late"); }
  async function use(tag) { for (const v of a) show(tag, v); const [p, q, r] = a; show(tag, r); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateElementsStoredLate() {
  const a = [1, 2];
  function install() { a[0] = "late"; }
  async function use(tag) { for (const v of a) show(tag, v); const [p] = a; show(tag, p); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateElementsMovedLate() {
  const a = [1, "s"];
  function install() { a.reverse(); }
  async function use(tag) { const [p] = a; show(tag, p); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateMapEntriesLate() {
  const m = new Map([[1, 1]]);
  function install() { m.set("late", "late"); }
  async function use(tag) { for (const [k, v] of m) { show(tag, k); show(tag, v); } for (const k of m.keys()) show(tag, k); for (const v of m.values()) show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateBuiltinsLateIterator() {
  const o = { length: 0 };
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { try { show(tag, Array.from(o)[0]); show(tag, [...new Set(o)][0]); show(tag, (await Promise.all(o))[0]); } catch (e) { print(tag, 'threw'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function iterateMapConstructorLate() {
  const o = [];
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 1, value: ["late", "late"] }; } }; }; }
  async function use(tag) { const m = new Map(o); for (const [k, v] of m) { show(tag, k); show(tag, v); } show(tag, m.size); }
  await use('first');
  h0(install);
  await use('second');
}

async function forAwaitLateAsyncIterator() {
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } }; } };
  function install() { o[Symbol.asyncIterator] = function () { let i = 0; return { next() { return Promise.resolve({ done: i++ >= 2, value: "late" }); } }; }; }
  async function use(tag) { for await (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function forAwaitSyncValuesThenable() {
  const t = { v: 1 }; const o = [t];
  function install() { t.then = function (res) { res("late"); }; }
  async function use(tag) { for await (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function forAwaitResultThenable() {
  const r = { done: false, value: 1 }; let i = 0; const o = { [Symbol.asyncIterator]() { i = 0; return { next() { r.done = i++ >= 1; return r; } }; } };
  function install() { r.then = function (res) { res({ done: i > 1, value: "late" }); }; }
  async function use(tag) { for await (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function spreadCallLate() {
  let x = [1, 2]; function f(a, b) { show('arg', a); show('arg', b); }
  function install() { x = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; } }; }
  async function use(tag) { f(...x); }
  await use('first');
  h0(install);
  await use('second');
}

async function builtinArgumentBecomesIterable() {
  let o = 'ab';
  function install() { o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; } }; }
  async function use(tag) { show(tag, Array.from(o)[0]); show(tag, [...new Set(o)][0]); }
  await use('first');
  h0(install);
  await use('second');
}

async function iteratorGetterLate() {
  const o = {};
  function install() { Object.defineProperty(o, Symbol.iterator, { get() { return function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; } }); }
  async function use(tag) { try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function nextGetterLate() {
  let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };
  function install() { Object.defineProperty(it, "next", { get() { return function () { return { done: i++ >= 2, value: "late" }; }; } }); }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function iteratorClassMethodLate() {
  class Bag { constructor() { this.items = [1, 2]; } } const b = new Bag();
  function install() { Bag.prototype[Symbol.iterator] = function* () { for (const x of this.items) yield String(x); }; }
  async function use(tag) { try { for (const x of b) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function iteratorSubclassLate() {
  class Base { *[Symbol.iterator]() { yield 1; } } class Sub extends Base {} let b = new Base();
  function install() { Sub.prototype[Symbol.iterator] = function* () { yield 'late'; }; b = new Sub(); }
  async function use(tag) { for (const x of b) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function arraySubclassIteratorLate() {
  class List extends Array {} const l = List.from([1, 2]);
  function install() { List.prototype[Symbol.iterator] = function* () { yield 'late'; }; }
  async function use(tag) { for (const x of l) show(tag, x); const [p] = l; show(tag, p); show(tag, [...l].length); }
  await use('first');
  h0(install);
  await use('second');
}

async function asyncIteratorOnPrototypeLate() {
  class Feed { *[Symbol.iterator]() { yield 1; } } const f = new Feed();
  function install() { Feed.prototype[Symbol.asyncIterator] = async function* () { yield 'late'; }; }
  async function use(tag) { for await (const x of f) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function destructuringDefaultLate() {
  let a = [1];
  function install() { a = [undefined, 'late']; }
  async function use(tag) { const [p = 'default', q = 5] = a; show(tag, p); show(tag, q); }
  await use('first');
  h0(install);
  await use('second');
}

async function destructuringRestLate() {
  let a = [1, 2, 3];
  function install() { a = new Set(['late', 'x']); }
  async function use(tag) { const [p, ...rest] = a; show(tag, p); show(tag, rest[0]); show(tag, rest.length); }
  await use('first');
  h0(install);
  await use('second');
}

async function arrayFromMapLate() {
  let src = [1, 2]; let f = x => x + 1;
  function install() { f = x => 'late' + x; }
  async function use(tag) { show(tag, Array.from(src, f)[0]); }
  await use('first');
  h0(install);
  await use('second');
}

async function setElementsLate() {
  const s = new Set([1]);
  function install() { s.add('late'); }
  async function use(tag) { for (const x of s) show(tag, x); show(tag, [...s][s.size - 1]); s.forEach(x => show(tag + ' each', x)); }
  await use('first');
  h0(install);
  await use('second');
}

async function setFromIterableLate() {
  const src = [1];
  function install() { src.push('late'); }
  async function use(tag) { const s = new Set(src); for (const x of s) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function mapFromEntriesLate() {
  const src = [[1, 1]];
  function install() { src.push(['late', { deep: 'late' }]); }
  async function use(tag) { const m = new Map(src); for (const [k, v] of m) { show(tag, k); show(tag, v); } }
  await use('first');
  h0(install);
  await use('second');
}

async function objectEntriesLate() {
  const o = { a: 1 };
  function install() { o.b = 'late'; }
  async function use(tag) { for (const [k, v] of Object.entries(o)) { show(tag, k); show(tag, v); } for (const v of Object.values(o)) show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# iterate own iterator');
  await iterateOwnIterator().catch(e => print('failed', String(e)));
  print('# iterate proto iterator');
  await iterateProtoIterator().catch(e => print('failed', String(e)));
  print('# iterate iterator replaced');
  await iterateIteratorReplaced().catch(e => print('failed', String(e)));
  print('# iterate next replaced');
  await iterateNextReplaced().catch(e => print('failed', String(e)));
  print('# iterate next on proto');
  await iterateNextOnProto().catch(e => print('failed', String(e)));
  print('# iterate return appears');
  await iterateReturnAppears().catch(e => print('failed', String(e)));
  print('# iterate array own iterator');
  await iterateArrayOwnIterator().catch(e => print('failed', String(e)));
  print('# iterate array values result own next');
  await iterateArrayValuesResultOwnNext().catch(e => print('failed', String(e)));
  print('# iterate result value late');
  await iterateResultValueLate().catch(e => print('failed', String(e)));
  print('# iterate result value getter');
  await iterateResultValueGetter().catch(e => print('failed', String(e)));
  print('# iterate result value on proto');
  await iterateResultValueOnProto().catch(e => print('failed', String(e)));
  print('# iterate result done getter');
  await iterateResultDoneGetter().catch(e => print('failed', String(e)));
  print('# iterate second result object');
  await iterateSecondResultObject().catch(e => print('failed', String(e)));
  print('# iterate second iterable');
  await iterateSecondIterable().catch(e => print('failed', String(e)));
  print('# iterate third iterable');
  await iterateThirdIterable().catch(e => print('failed', String(e)));
  print('# iterate elements late');
  await iterateElementsLate().catch(e => print('failed', String(e)));
  print('# iterate elements stored late');
  await iterateElementsStoredLate().catch(e => print('failed', String(e)));
  print('# iterate elements moved late');
  await iterateElementsMovedLate().catch(e => print('failed', String(e)));
  print('# iterate map entries late');
  await iterateMapEntriesLate().catch(e => print('failed', String(e)));
  print('# iterate builtins late iterator');
  await iterateBuiltinsLateIterator().catch(e => print('failed', String(e)));
  print('# iterate map constructor late');
  await iterateMapConstructorLate().catch(e => print('failed', String(e)));
  print('# for await late async iterator');
  await forAwaitLateAsyncIterator().catch(e => print('failed', String(e)));
  print('# for await sync values thenable');
  await forAwaitSyncValuesThenable().catch(e => print('failed', String(e)));
  print('# for await result thenable');
  await forAwaitResultThenable().catch(e => print('failed', String(e)));
  print('# spread call late');
  await spreadCallLate().catch(e => print('failed', String(e)));
  print('# builtin argument becomes iterable');
  await builtinArgumentBecomesIterable().catch(e => print('failed', String(e)));
  print('# iterator getter late');
  await iteratorGetterLate().catch(e => print('failed', String(e)));
  print('# next getter late');
  await nextGetterLate().catch(e => print('failed', String(e)));
  print('# iterator class method late');
  await iteratorClassMethodLate().catch(e => print('failed', String(e)));
  print('# iterator subclass late');
  await iteratorSubclassLate().catch(e => print('failed', String(e)));
  print('# array subclass iterator late');
  await arraySubclassIteratorLate().catch(e => print('failed', String(e)));
  print('# async iterator on prototype late');
  await asyncIteratorOnPrototypeLate().catch(e => print('failed', String(e)));
  print('# destructuring default late');
  await destructuringDefaultLate().catch(e => print('failed', String(e)));
  print('# destructuring rest late');
  await destructuringRestLate().catch(e => print('failed', String(e)));
  print('# array from map late');
  await arrayFromMapLate().catch(e => print('failed', String(e)));
  print('# set elements late');
  await setElementsLate().catch(e => print('failed', String(e)));
  print('# set from iterable late');
  await setFromIterableLate().catch(e => print('failed', String(e)));
  print('# map from entries late');
  await mapFromEntriesLate().catch(e => print('failed', String(e)));
  print('# object entries late');
  await objectEntriesLate().catch(e => print('failed', String(e)));
}
main();
