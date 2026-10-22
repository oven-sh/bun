// An object that is the reason of a rejection, so that the host has seen it, gets a method or other contents after it was looked at once, in code that is reached through a chain of calls.
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

async function escapedEarlyAwaitThen() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };escape(o);
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyAwaitProtoThen() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const P = {}; const o = Object.create(P);escape(o);
  function install() { P.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyIterator() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };escape(o);
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; }
  async function use(tag) { try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyNext() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };escape(it);
  function install() { it.next = function () { return { done: i++ >= 2, value: "late" }; }; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyReturn() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } };escape(it);
  function install() { it.return = function () { state = "changed"; return {}; }; }
  async function use(tag) { const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyValueof() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; const o = { v: 1 };escape(o);
  function install() { o.valueOf = function () { state = "changed"; return 7; }; }
  async function use(tag) { const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyTostringOnClass() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; class C {} const o = new C();escape(o);
  function install() { C.prototype.toString = function () { state = "changed"; return "late"; }; }
  async function use(tag) { const before = state; show(tag, `${o}`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyResultValue() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };escape(r);
  function install() { r.value = "late"; }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyArrayElements() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const a = [1, 2];escape(a);
  function install() { a.push("late"); }
  async function use(tag) { for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyGenerator() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g();escape(it);
  function install() { sent = "late"; }
  async function use(tag) { if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyPromise() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let give; const p = new Promise(r => { give = r; });escape(p);
  function install() { give("late"); }
  async function use(tag) { if (tag === 'second') show(tag, await p); else show(tag, 0); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedEarlyField() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };escape(o);
  function install() { o.v = "late"; }
  async function use(tag) { show(tag, o.v); const { v } = o; show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateAwaitThen() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };
  function install() { o.then = function (res) { res("late"); }; escape(o); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateAwaitProtoThen() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const P = {}; const o = Object.create(P);
  function install() { P.then = function (res) { res("late"); }; escape(o); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateIterator() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };
  function install() { o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; }; escape(o); }
  async function use(tag) { try { for (const x of o) show(tag, x); } catch (e) { print(tag, 'not iterable'); } }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateNext() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let i = 0; const it = { next() { return { done: i++ >= 2, value: 1 }; } }; const o = { [Symbol.iterator]() { i = 0; return it; } };
  function install() { it.next = function () { return { done: i++ >= 2, value: "late" }; }; escape(it); }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateReturn() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; let i = 0; const it = { next() { return { done: false, value: i++ }; } }; const o = { [Symbol.iterator]() { return it; } };
  function install() { it.return = function () { state = "changed"; return {}; }; escape(it); }
  async function use(tag) { const before = state; for (const x of o) { show(tag, x); break; } show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateValueof() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; const o = { v: 1 };
  function install() { o.valueOf = function () { state = "changed"; return 7; }; escape(o); }
  async function use(tag) { const before = state; show(tag, o + 1); show(tag, o * 2); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateTostringOnClass() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let state = 0; class C {} const o = new C();
  function install() { C.prototype.toString = function () { state = "changed"; return "late"; }; escape(o); }
  async function use(tag) { const before = state; show(tag, `${o}`); show(tag, ({ late: 1 })[o]); show(tag, state); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateResultValue() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let i = 0; const r = { done: false, value: 1 }; const o = { [Symbol.iterator]() { i = 0; return { next() { r.done = i++ >= 2; return r; } }; } };
  function install() { r.value = "late"; escape(r); }
  async function use(tag) { for (const x of o) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateArrayElements() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const a = [1, 2];
  function install() { a.push("late"); escape(a); }
  async function use(tag) { for (const x of a) show(tag, x); const [p, q, r] = a; show(tag, r); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateGenerator() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let sent = 1; function* g() { const x = yield 1; show('sent', x); } const it = g();
  function install() { sent = "late"; escape(it); }
  async function use(tag) { if (tag === 'second') { it.next(); it.next(sent); } else show(tag, 0); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLatePromise() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } let give; const p = new Promise(r => { give = r; });
  function install() { give("late"); escape(p); }
  async function use(tag) { if (tag === 'second') show(tag, await p); else show(tag, 0); }
  await use('first');
  h0(install);
  await use('second');
}

async function escapedLateField() {
  async function boom(x) { throw x; } function escape(x) { boom(x).then(undefined, () => {}); } const o = { v: 1 };
  function install() { o.v = "late"; escape(o); }
  async function use(tag) { show(tag, o.v); const { v } = o; show(tag, v); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# escaped early await then');
  await escapedEarlyAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped early await proto then');
  await escapedEarlyAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped early iterator');
  await escapedEarlyIterator().catch(e => print('failed', String(e)));
  print('# escaped early next');
  await escapedEarlyNext().catch(e => print('failed', String(e)));
  print('# escaped early return');
  await escapedEarlyReturn().catch(e => print('failed', String(e)));
  print('# escaped early valueof');
  await escapedEarlyValueof().catch(e => print('failed', String(e)));
  print('# escaped early tostring on class');
  await escapedEarlyTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped early result value');
  await escapedEarlyResultValue().catch(e => print('failed', String(e)));
  print('# escaped early array elements');
  await escapedEarlyArrayElements().catch(e => print('failed', String(e)));
  print('# escaped early generator');
  await escapedEarlyGenerator().catch(e => print('failed', String(e)));
  print('# escaped early promise');
  await escapedEarlyPromise().catch(e => print('failed', String(e)));
  print('# escaped early field');
  await escapedEarlyField().catch(e => print('failed', String(e)));
  print('# escaped late await then');
  await escapedLateAwaitThen().catch(e => print('failed', String(e)));
  print('# escaped late await proto then');
  await escapedLateAwaitProtoThen().catch(e => print('failed', String(e)));
  print('# escaped late iterator');
  await escapedLateIterator().catch(e => print('failed', String(e)));
  print('# escaped late next');
  await escapedLateNext().catch(e => print('failed', String(e)));
  print('# escaped late return');
  await escapedLateReturn().catch(e => print('failed', String(e)));
  print('# escaped late valueof');
  await escapedLateValueof().catch(e => print('failed', String(e)));
  print('# escaped late tostring on class');
  await escapedLateTostringOnClass().catch(e => print('failed', String(e)));
  print('# escaped late result value');
  await escapedLateResultValue().catch(e => print('failed', String(e)));
  print('# escaped late array elements');
  await escapedLateArrayElements().catch(e => print('failed', String(e)));
  print('# escaped late generator');
  await escapedLateGenerator().catch(e => print('failed', String(e)));
  print('# escaped late promise');
  await escapedLatePromise().catch(e => print('failed', String(e)));
  print('# escaped late field');
  await escapedLateField().catch(e => print('failed', String(e)));
}
main();
