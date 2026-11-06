// RUN: lower
// OPTIONS: builtin-modules

// What a loop, a pattern or a spread finds (@@iterator, next, return, the results, the contents) changes after it has run once, in code that is reached through a chain of calls.
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

// GENERATED: asyncIteratorOnPrototypeLate other [Symbol.asyncIterator] Base Sub
// CHECK-LABEL: function {{*}}name="asyncIteratorOnPrototypeLate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = NewClosure function=[[f_4]]
// CHECK-NEXT: v7 = NewClass v6 layout=[[L_5]]
// CHECK-NEXT: v8 = NewClosure function=[[f_6]]
// CHECK-NEXT: DefineMethod v7, v8 layout=[[L_5]] key=@@iterator
// CHECK-NEXT: v10 = FinishClass v7 layout=[[L_5]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Convert v10 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v12 layout=[[L_1]]
// CHECK-NEXT: v14 = Construct v12 calleeName="Feed"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v15 layout=[[L_1]] field=1
// CHECK-NEXT: v17 = String string="first"
// CHECK-NEXT: v18 = Call v5, -, v17 calleeName="use"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v20 = Await v19
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v22 = Call v21, -, v3 calleeName="h0"
// CHECK-NEXT: v23 = String string="second"
// CHECK-NEXT: v24 = Call v5, -, v23 calleeName="use"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v26 = Await v25
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="other"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_9]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="i"
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="i"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_8]]
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = GreaterEq v3, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v12 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v12, v11 key="done"
// CHECK-NEXT: v14 = String string="late"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string flags=[IsExpected]}
// CHECK-NEXT: PropDefine v12, v15 key="value"
// CHECK-NEXT: v17 = FinishObject v12
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncIterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}, {type=undefined|null|[[L_9]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_11]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_10]], v1: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_10]] field=1
// CHECK-NEXT: v3 = CheckInitialized v2 name="i"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_10]] field=1
// CHECK-NEXT: v7 = NewClosure v0, v1 function=[[f_12]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_13]]|[[f_14]]|[[f_15]]|[[f_16]]|[[f_17]]|[[f_18]]|[[f_19]]|[[f_20]]|[[f_21]]|[[f_22]]|[[f_23]]|[[f_24]]|[[f_25]]|[[f_26]]|[[f_27]]|[[f_28]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v9, v8 key="next"
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_29]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_30]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_30]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_30]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Sub"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_31]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_32]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_32]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
