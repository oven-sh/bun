// What a generator is sent, yields, returns and inherits changes after it has run once, in code that is reached through a chain of calls.
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

async function generatorSentLate() {
  let sent = 1; function* g() { while (true) { const x = yield 0; show('in generator', x); } }
  function install() { sent = "late"; }
  async function use(tag) { const it = g(); it.next(); it.next(sent); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorSentObjectLate() {
  let sent = { a: 1 }; function* g() { while (true) { const x = yield 0; show('in generator', x); show('field', x.a); } }
  function install() { sent = { a: "late", b: 2 }; }
  async function use(tag) { const it = g(); it.next(); it.next(sent); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorYieldLate() {
  let y = 1; function* g() { yield y; yield y; }
  function install() { y = "late"; }
  async function use(tag) { for (const x of g()) show(tag, x); const [a] = g(); show(tag, a); show(tag, [...g()][1]); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorReturnLate() {
  let y = 1; function* g() { yield 0; return y; }
  function install() { y = "late"; }
  async function use(tag) { const it = g(); it.next(); show(tag, it.next().value); function* d() { const r = yield* g(); show(tag + ' delegated', r); } for (const x of d()) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorThrowLate() {
  let y = 1; function* g() { try { yield 0; } catch (e) { show('caught in generator', e); } }
  function install() { y = "late"; }
  async function use(tag) { const it = g(); it.next(); it.throw(y); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorPrototypeReplaced() {
  function* g() { yield 1; }
  function install() { g.prototype = { next() { return { done: true, value: "late" }; }, [Symbol.iterator]() { let n = 0; return { next() { return { done: n++ >= 1, value: "late" }; } }; } }; }
  async function use(tag) { for (const x of g()) show(tag, x); show(tag, g().next().value); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorOwnPrototypeNext() {
  function* g() { yield 1; }
  function install() { let n = 0; g.prototype.next = function () { return { done: n++ % 2 === 1, value: "late" }; }; }
  async function use(tag) { for (const x of g()) show(tag, x); const [a] = g(); show(tag, a); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorReturnMethodLate() {
  let closed = 0; function* g() { yield 1; yield 2; }
  function install() { g.prototype.return = function () { closed = "closed"; return {}; }; }
  async function use(tag) { for (const x of g()) { show(tag, x); break; } show(tag, closed); }
  await use('first');
  h0(install);
  await use('second');
}

async function yieldStarLateIterable() {
  let inner = [1]; function* g() { yield* inner; }
  function install() { inner = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i++ >= 2, value: "late" }; } }; } }; }
  async function use(tag) { for (const x of g()) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function asyncGeneratorLate() {
  let y = 1; async function* g() { yield y; }
  function install() { y = Promise.resolve("late"); }
  async function use(tag) { for await (const x of g()) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function asyncGeneratorYieldThenable() {
  const t = { v: 1 }; async function* g() { yield t; }
  function install() { t.then = function (res) { res("late"); }; }
  async function use(tag) { for await (const x of g()) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorReturnCallLate() {
  let v = 1; function* g() { try { yield 0; } finally { show('finally', v); } }
  function install() { v = 'late'; }
  async function use(tag) { const it = g(); it.next(); show(tag, it.return(v).value); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorThrowUncaughtLate() {
  let v = 1; function* g() { yield 0; }
  function install() { v = 'late'; }
  async function use(tag) { const it = g(); it.next(); try { it.throw(v); } catch (e) { show(tag + ' caught', e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorStoredLate() {
  function* one() { yield 1; } function* two() { yield 'late'; } let make = one;
  function install() { make = two; }
  async function use(tag) { for (const x of make()) show(tag, x); const it = make(); show(tag, it.next().value); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorArgumentLate() {
  let arg = 1; function* g(a) { yield a; }
  function install() { arg = 'late'; }
  async function use(tag) { for (const x of g(arg)) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorThisLate() {
  const holder = { v: 1, *g() { yield this.v; } };
  function install() { holder.v = 'late'; }
  async function use(tag) { for (const x of holder.g()) show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function generatorEscapesLate() {
  function* g() { const x = yield 1; show('sent', x); } const box = [];
  function install() { box.push(g()); }
  async function use(tag) { for (const it of box) { it.next(); it.next('late'); } show(tag, box.length); }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# generator sent late');
  await generatorSentLate().catch(e => print('failed', String(e)));
  print('# generator sent object late');
  await generatorSentObjectLate().catch(e => print('failed', String(e)));
  print('# generator yield late');
  await generatorYieldLate().catch(e => print('failed', String(e)));
  print('# generator return late');
  await generatorReturnLate().catch(e => print('failed', String(e)));
  print('# generator throw late');
  await generatorThrowLate().catch(e => print('failed', String(e)));
  print('# generator prototype replaced');
  await generatorPrototypeReplaced().catch(e => print('failed', String(e)));
  print('# generator own prototype next');
  await generatorOwnPrototypeNext().catch(e => print('failed', String(e)));
  print('# generator return method late');
  await generatorReturnMethodLate().catch(e => print('failed', String(e)));
  print('# yield star late iterable');
  await yieldStarLateIterable().catch(e => print('failed', String(e)));
  print('# async generator late');
  await asyncGeneratorLate().catch(e => print('failed', String(e)));
  print('# async generator yield thenable');
  await asyncGeneratorYieldThenable().catch(e => print('failed', String(e)));
  print('# generator return call late');
  await generatorReturnCallLate().catch(e => print('failed', String(e)));
  print('# generator throw uncaught late');
  await generatorThrowUncaughtLate().catch(e => print('failed', String(e)));
  print('# generator stored late');
  await generatorStoredLate().catch(e => print('failed', String(e)));
  print('# generator argument late');
  await generatorArgumentLate().catch(e => print('failed', String(e)));
  print('# generator this late');
  await generatorThisLate().catch(e => print('failed', String(e)));
  print('# generator escapes late');
  await generatorEscapesLate().catch(e => print('failed', String(e)));
}
main();
