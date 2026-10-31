// RUN: lower
// OPTIONS: builtin-modules

// What an await finds (a `then`, a constructor, a settled value) changes after the await has run once, in code that is reached through a chain of calls.
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

async function awaitOwnThen() {
  const o = { v: 1 };
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitProtoThen() {
  const P = { p: 1 }; const o = Object.create(P); o.v = 1;
  function install() { P.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitClassThen() {
  class C { constructor() { this.v = 1; } } const o = new C();
  function install() { C.prototype.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitSetPrototype() {
  const o = { v: 1 }; const T = { then(res) { res("late"); } };
  function install() { Object.setPrototypeOf(o, T); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitProtoOfProto() {
  const A = { a: 1 }; const B = Object.create(A); const o = Object.create(B); const T = { then(res) { res("late"); } };
  function install() { Object.setPrototypeOf(A, T); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitGetterThen() {
  const o = { v: 1 };
  function install() { Object.defineProperty(o, "then", { get() { return function (res) { res("late"); }; }, configurable: true }); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitComputedThen() {
  const o = { v: 1 }; const parts = ["th", "en"];
  function install() { o[parts.join("")] = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitAssignThen() {
  const o = { v: 1 }; const src = { then(res) { res("late"); } };
  function install() { Object.assign(o, src); }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenReplaced() {
  const o = { v: 1, then(res) { res(1); } };
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenFieldUndefined() {
  const o = { v: 1, then: undefined };
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitPromiseOwnThen() {
  const p = Promise.resolve(1);
  function install() { p.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitPromiseConstructor() {
  const p = Promise.resolve(1); let seen = 0;
  function install() { p.constructor = { [Symbol.species]: function (executor) { seen = "species"; return new Promise(executor); } }; }
  async function use(tag) { show(tag, await p); show(tag, seen); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitSubclass() {
  let seen = 0; class MyPromise extends Promise { then(a, b) { seen = "then"; return super.then(a, b); } } let p = Promise.resolve(1);
  function install() { p = MyPromise.resolve("late"); }
  async function use(tag) { show(tag, await p); show(tag, seen); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitSlotFillsLate() {
  let resolve; const p = new Promise(r => { resolve = r; }); let started = false;
  function install() { resolve({ a: 1, b: 2 }); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); return; } show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitSlotTwoTypes() {
  let box = { r: null }; const p = new Promise(r => { box.r = r; }); function early() { if (box.never) box.r(1); }
  function install() { early(); box.r("late"); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); return; } show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitNestedPromises() {
  let r3; const p3 = new Promise(r => { r3 = r; }); const p2 = new Promise(r => r(p3)); const p1 = new Promise(r => r(p2)); const p0 = Promise.resolve(p1); async function wrap() { return p0; }
  function install() { r3("late"); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); return; } show(tag, await wrap()); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitNestedThenable() {
  const inner = { v: 1 }; const p2 = Promise.resolve().then(() => inner); async function wrap() { return p2; }
  function install() { inner.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await wrap()); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitAsyncReturnThenable() {
  const o = { v: 1 }; async function f() { return o; }
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await f()); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitResolveThenable() {
  const o = { v: 1 };
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await Promise.resolve(o)); show(tag, await new Promise(r => r(o))); show(tag, await Promise.resolve(0).then(() => o)); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitAllThenable() {
  const o = { v: 1 };
  function install() { o.then = function (res) { res("late"); }; }
  async function use(tag) { const [a] = await Promise.all([o]); show(tag, a); show(tag, await Promise.race([o])); const [s] = await Promise.allSettled([o]); show(tag, s.value); show(tag, await Promise.any([o])); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitSecondObject() {
  let x = { v: 1 }; class T { then(res) { res("late"); } }
  function install() { x = new T(); }
  async function use(tag) { show(tag, await x); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenableRejects() {
  const o = { v: 1 };
  function install() { o.then = function (res, rej) { rej("late"); }; }
  async function use(tag) { try { show(tag, await o); } catch (e) { show(tag + ' caught', e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenableThrows() {
  const o = { v: 1 };
  function install() { o.then = function () { throw "late"; }; }
  async function use(tag) { try { show(tag, await o); } catch (e) { show(tag + ' caught', e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenGetterThrows() {
  const o = { v: 1 };
  function install() { Object.defineProperty(o, "then", { get() { throw "late"; }, configurable: true }); }
  async function use(tag) { try { show(tag, await o); } catch (e) { show(tag + ' caught', e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenSideEffect() {
  const o = { v: 1 }; let state = 0;
  function install() { o.then = function (res) { state = "changed"; res(this.v); }; }
  async function use(tag) { const before = state; const r = await o; show(tag, before); show(tag, state); show(tag, r); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenableResolvesThenable() {
  const a = { v: 1 }; const b = { w: 2 };
  function install() { a.then = function (res) { res(b); }; b.then = function (res) { res("late"); }; }
  async function use(tag) { show(tag, await a); }
  await use('first');
  h0(install);
  await use('second');
}

async function builtinArgumentBecomesThenable() {
  let o = 1;
  function install() { o = { then(res) { res("late"); } }; }
  async function use(tag) { show(tag, await Promise.resolve(o)); show(tag, (await Promise.all([o]))[0]); show(tag, await Promise.resolve(0).then(() => o)); }
  await use('first');
  h0(install);
  await use('second');
}

async function speciesPromiseThenLate() {
  let state = 0; const p = Promise.resolve(1);
  function install() { p.constructor = { [Symbol.species]: function (executor) { state = "changed"; return new Promise(executor); } }; }
  async function use(tag) { const before = state; const q = p.then(x => x); show(tag, state); show(tag, await q); show(tag, before); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitLoopCarried() {
  let step = x => x + 1;
  function install() { step = x => 'late' + x; }
  async function use(tag) { let x = 1; for (let i = 0; i < 2; i++) x = await step(x); show(tag, x); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitFromContainer() {
  const box = [Promise.resolve(1)];
  function install() { box.push({ then(res) { res('late'); } }); }
  async function use(tag) { for (const p of box) show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitFromMap() {
  const m = new Map([['a', Promise.resolve(1)]]);
  function install() { m.set('a', { then(res) { res('late'); } }); }
  async function use(tag) { show(tag, await m.get('a')); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitFactoryThenable() {
  class T { then(res) { res('late'); } } class N { constructor() { this.n = 1; } } let K = N; function make() { return new K(); }
  function install() { K = T; }
  async function use(tag) { show(tag, await make()); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenCalledWithThis() {
  const o = { v: 1 };
  function install() { o.then = function (res) { res(this === o ? 'late' : 0); }; }
  async function use(tag) { show(tag, await o); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitThenableResolveArgumentEscapes() {
  const o = { v: 1 }; const payload = { a: 1 };
  function install() { o.then = function (res) { payload.a = 'late'; res(payload); }; }
  async function use(tag) { const r = await o; show(tag, r); show(tag, r.a); show(tag, payload.a); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitFinallyLate() {
  let state = 0; let cb = () => {};
  function install() { cb = () => { state = 'changed'; }; }
  async function use(tag) { await Promise.resolve(1).finally(cb); show(tag, state); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitCatchLate() {
  let reason = 1;
  function install() { reason = 'late'; }
  async function use(tag) { try { await Promise.reject(reason); } catch (e) { show(tag, e); } show(tag, await Promise.reject(reason).catch(e => e)); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitAsyncThrowLate() {
  let reason = 1; async function f() { throw reason; }
  function install() { reason = { late: 1 }; }
  async function use(tag) { try { await f(); } catch (e) { show(tag, e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitPromiseFieldLate() {
  const holder = { p: Promise.resolve(1) };
  function install() { holder.p = Promise.resolve('late'); }
  async function use(tag) { show(tag, await holder.p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitWithResolvers() {
  const w = Promise.withResolvers();
  function install() { w.resolve('late'); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); } else show(tag, await w.promise); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitResolveFunctionEscapes() {
  const fns = []; const p = new Promise(r => fns.push(r));
  function install() { for (const f of fns) f('late'); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); } else show(tag, await p); }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitRejectFunctionLate() {
  let rej; const p = new Promise((a, b) => { rej = b; });
  function install() { rej('late'); }
  async function use(tag) { if (tag === 'first') { show(tag, 0); } else { try { await p; } catch (e) { show(tag + ' caught', e); } } }
  await use('first');
  h0(install);
  await use('second');
}

async function awaitExecutorThrowsLate() {
  let v = 1;
  function install() { v = 'late'; }
  async function use(tag) { try { await new Promise(() => { throw v; }); } catch (e) { show(tag + ' caught', e); } }
  await use('first');
  h0(install);
  await use('second');
}

async function main() {
  print('# await own then');
  await awaitOwnThen().catch(e => print('failed', String(e)));
  print('# await proto then');
  await awaitProtoThen().catch(e => print('failed', String(e)));
  print('# await class then');
  await awaitClassThen().catch(e => print('failed', String(e)));
  print('# await set prototype');
  await awaitSetPrototype().catch(e => print('failed', String(e)));
  print('# await proto of proto');
  await awaitProtoOfProto().catch(e => print('failed', String(e)));
  print('# await getter then');
  await awaitGetterThen().catch(e => print('failed', String(e)));
  print('# await computed then');
  await awaitComputedThen().catch(e => print('failed', String(e)));
  print('# await assign then');
  await awaitAssignThen().catch(e => print('failed', String(e)));
  print('# await then replaced');
  await awaitThenReplaced().catch(e => print('failed', String(e)));
  print('# await then field undefined');
  await awaitThenFieldUndefined().catch(e => print('failed', String(e)));
  print('# await promise own then');
  await awaitPromiseOwnThen().catch(e => print('failed', String(e)));
  print('# await promise constructor');
  await awaitPromiseConstructor().catch(e => print('failed', String(e)));
  print('# await subclass');
  await awaitSubclass().catch(e => print('failed', String(e)));
  print('# await slot fills late');
  await awaitSlotFillsLate().catch(e => print('failed', String(e)));
  print('# await slot two types');
  await awaitSlotTwoTypes().catch(e => print('failed', String(e)));
  print('# await nested promises');
  await awaitNestedPromises().catch(e => print('failed', String(e)));
  print('# await nested thenable');
  await awaitNestedThenable().catch(e => print('failed', String(e)));
  print('# await async return thenable');
  await awaitAsyncReturnThenable().catch(e => print('failed', String(e)));
  print('# await resolve thenable');
  await awaitResolveThenable().catch(e => print('failed', String(e)));
  print('# await all thenable');
  await awaitAllThenable().catch(e => print('failed', String(e)));
  print('# await second object');
  await awaitSecondObject().catch(e => print('failed', String(e)));
  print('# await thenable rejects');
  await awaitThenableRejects().catch(e => print('failed', String(e)));
  print('# await thenable throws');
  await awaitThenableThrows().catch(e => print('failed', String(e)));
  print('# await then getter throws');
  await awaitThenGetterThrows().catch(e => print('failed', String(e)));
  print('# await then side effect');
  await awaitThenSideEffect().catch(e => print('failed', String(e)));
  print('# await thenable resolves thenable');
  await awaitThenableResolvesThenable().catch(e => print('failed', String(e)));
  print('# builtin argument becomes thenable');
  await builtinArgumentBecomesThenable().catch(e => print('failed', String(e)));
  print('# species promise then late');
  await speciesPromiseThenLate().catch(e => print('failed', String(e)));
  print('# await loop carried');
  await awaitLoopCarried().catch(e => print('failed', String(e)));
  print('# await from container');
  await awaitFromContainer().catch(e => print('failed', String(e)));
  print('# await from map');
  await awaitFromMap().catch(e => print('failed', String(e)));
  print('# await factory thenable');
  await awaitFactoryThenable().catch(e => print('failed', String(e)));
  print('# await then called with this');
  await awaitThenCalledWithThis().catch(e => print('failed', String(e)));
  print('# await thenable resolve argument escapes');
  await awaitThenableResolveArgumentEscapes().catch(e => print('failed', String(e)));
  print('# await finally late');
  await awaitFinallyLate().catch(e => print('failed', String(e)));
  print('# await catch late');
  await awaitCatchLate().catch(e => print('failed', String(e)));
  print('# await async throw late');
  await awaitAsyncThrowLate().catch(e => print('failed', String(e)));
  print('# await promise field late');
  await awaitPromiseFieldLate().catch(e => print('failed', String(e)));
  print('# await with resolvers');
  await awaitWithResolvers().catch(e => print('failed', String(e)));
  print('# await resolve function escapes');
  await awaitResolveFunctionEscapes().catch(e => print('failed', String(e)));
  print('# await reject function late');
  await awaitRejectFunctionLate().catch(e => print('failed', String(e)));
  print('# await executor throws late');
  await awaitExecutorThrowsLate().catch(e => print('failed', String(e)));
}
main();

// GENERATED: awaitProtoThen awaitFromMap MyPromise make
// CHECK-LABEL: function {{*}}name="awaitProtoThen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Data data=[[d_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v7 layout=[[L_1]]
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v11 = Call v10, v9, v7 calleeName="Object.create"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v12 layout=[[L_1]] field=1
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: PropSet v12, v14 key="v"
// CHECK-NEXT: v16 = String string="first"
// CHECK-NEXT: v17 = Call v5, -, v16 calleeName="use"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v19 = Await v18
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v21 = Call v20, -, v3 calleeName="h0"
// CHECK-NEXT: v22 = String string="second"
// CHECK-NEXT: v23 = Call v5, -, v22 calleeName="use"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v25 = Await v24
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="awaitFromMap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_8]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = String string="a"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Promise" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="resolve"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Promise<number> flags=[IsExpected]}
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = Builtin builtin=Map
// CHECK-NEXT: v17 = Construct v16 calleeName="Map"
// CHECK-NEXT: v18 = Builtin builtin=MapPrototypeSet [isNotReadFromHolder]
// CHECK-NEXT: v19 = Call v18, v17, v6, v14
// CHECK-NEXT: v20 = Convert v17 declared={type=undefined|null|Map<undefined|null|string, undefined|null|Promise<number>> flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v20 layout=[[L_8]]
// CHECK-NEXT: v22 = String string="first"
// CHECK-NEXT: v23 = Call v5, -, v22 calleeName="use"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v25 = Await v24
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v27 = Call v26, -, v3 calleeName="h0"
// CHECK-NEXT: v28 = String string="second"
// CHECK-NEXT: v29 = Call v5, -, v28 calleeName="use"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v31 = Await v30
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="MyPromise"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_13]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_12]] field=2
// CHECK-NEXT: v2 = CheckInitialized v1 name="K"
// CHECK-NEXT: v3 = Construct v2 calleeName="K"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
