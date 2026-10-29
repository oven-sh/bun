// RUN: lower
// OPTIONS: builtin-modules

// `for (const [k, v] of Object.entries(o))` in every form: what is taken from the pair, what the loop does to the object meanwhile, how the loop is left, and what kind of thing `o` is.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "bigint" ? held + "n" : held);
const log = [];
function both(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(k, v); return out; }
function keyOnly(o) { let out = ""; for (const [k] of Object.entries(o)) out += k + ";"; return out; }
function valueOnly(o) { const out = []; for (const [, v] of Object.entries(o)) out.push(v); return out; }
function whole(o) { const out = []; for (const pair of Object.entries(o)) out.push(pair); return out; }
function wholeAndParts(o) { const out = []; for (const pair of Object.entries(o)) { const [k, v] = pair; pair.push(k + "!"); out.push(pair, v); } return out; }
function third(o) { const out = []; for (const [k, v, w] of Object.entries(o)) out.push(k, v, w); return out; }
function withDefault(o) { const out = []; for (const [k, v = "default", w = k + "?"] of Object.entries(o)) out.push(k, v, w); return out; }
function withRest(o) { const out = []; for (const [k, ...rest] of Object.entries(o)) out.push(k, rest, rest.length); return out; }
function nested(o) { const out = []; for (const [k, { a, b = k }] of Object.entries(o)) out.push(k, a, b); return out; }
function nestedArray(o) { const out = []; for (const [k, [first, second]] of Object.entries(o)) out.push(k, first, second); return out; }
function byIndex(o) { const out = []; for (const pair of Object.entries(o)) out.push(pair[0], pair[1], pair[2], pair.length); return out; }
function withLet(o) { const out = []; for (let [k, v] of Object.entries(o)) { k += "+"; v = [v]; out.push(k, v); } return out; }
function withVar(o) { for (var [k, v] of Object.entries(o)); return [k, v]; }
function toTargets(o) { const t = {}; const out = []; for ([t.k, t.v] of Object.entries(o)) out.push({ ...t }); return out; }
function closures(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(() => k + "=" + v); return out.map(f => f()); }
function changesValues(o) { const out = []; for (const [k, v] of Object.entries(o)) { for (const other in o) o[other] = "changed by " + k; out.push(k, v); } return [out, o]; }
function addsAndDeletes(o) { const out = []; let n = 0; for (const [k, v] of Object.entries(o)) { delete o[k]; o["added" + n++] = v; out.push(k, v); } return [out, Object.keys(o)]; }
function breaks(o) { const out = []; for (const [k, v] of Object.entries(o)) { if (v === 2) break; out.push(k); } return out; }
function continues(o) { const out = []; for (const [k, v] of Object.entries(o)) { if (v === 2) continue; out.push(k); } return out; }
function returns(o) { for (const [k, v] of Object.entries(o)) if (v === 2) return k; return "none"; }
function throwsInside(o) { try { for (const [k, v] of Object.entries(o)) if (v === 2) throw new Error("at " + k); } catch (e) { return e.message; } return "none"; }
function labeled(o, p) { const out = []; outer: for (const [k, v] of Object.entries(o)) { for (const [l, w] of Object.entries(p)) { if (w === v) continue outer; if (w > 2) break outer; out.push(k + l); } } return out; }
function sameTwice(o) { const out = []; for (const [k, v] of Object.entries(o)) for (const [l, w] of Object.entries(o)) out.push(k + l + (v === w)); return out; }
function inTry(o) { const out = []; try { for (const [k, v] of Object.entries(o)) out.push(k, v.x.y); } catch (e) { out.push(e.name); } finally { out.push("finally"); } return out; }
function* generator(o) { for (const [k, v] of Object.entries(o)) { const sent = yield [k, v]; if (sent) yield "sent " + sent + " at " + k; } }
async function asynchronous(o) { const out = []; for (const [k, v] of Object.entries(o)) out.push(k, await v); return out; }
function keptList(o) { const list = Object.entries(o); const out = []; for (const [k, v] of list) out.push(k, v); return [out, list.length, list[0]]; }
function conditional(o, c) { const out = []; for (const [k, v] of c ? Object.entries(o) : [["x", 1]]) out.push(k, v); return out; }
function mapped(o) { return Object.entries(o).map(([k, v]) => k + v).join(); }
function spreadList(o) { return [...Object.entries(o)].length; }
function extraArgument(o) { const out = []; for (const [k, v] of Object.entries(o, true)) out.push(k, v); return out; }
const plain = () => ({ a: 1, b: 2, c: 3 });
for (const f of [both, keyOnly, valueOnly, whole, wholeAndParts, third, withDefault, withRest, byIndex, withLet, withVar, toTargets, closures, changesValues, addsAndDeletes, breaks, continues, returns, throwsInside, sameTwice, keptList, mapped, spreadList, extraArgument])
  console.log(f.name, show(f(plain())), show(f({})), show(f({ only: undefined })));
console.log(show(nested({ p: { a: 1 }, q: { a: 2, b: 3 } })), show(nestedArray({ p: [1, 2], q: "xy", r: [] })), show(labeled(plain(), { x: 0, y: 2, z: 5 })), show(inTry({ a: { x: { y: 1 } }, b: {} })), show(conditional(plain(), true)), show(conditional(plain(), false)));
const pairs = whole(plain()); console.log(pairs[0] !== pairs[1], Array.isArray(pairs[0]), Object.getPrototypeOf(pairs[0]) === Array.prototype, pairs[0].length, show(Object.getOwnPropertyDescriptor(pairs[0], 0)), whole(plain())[0] !== pairs[0]);
const kinds = { array: [7, 8], holes: [1, , 3], string: "hi", number: 5, boolean: true, bigint: 10n, symbol: Symbol.iterator, func: Object.assign(function () {}, { own: 1 }), typed: new Uint8Array([4, 5]), map: new Map([[1, 2]]), date: new Date(0), regexp: /x/g,
  indexes: { 2: "two", b: "b", 1: "one", a: "a", [-1]: "minus" }, symbols: { [Symbol("s")]: 1, t: 2 }, nullProto: Object.assign(Object.create(null), { n: 1 }), inherits: Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true }, hidden: { value: 3 } }),
  frozen: Object.freeze({ f: 1 }), instance: new (class { x = 1; #y = 2; get z() { return 3; } })(), args: (function () { return arguments; })(1, 2), many: Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["k" + i, i])), boxed: Object("ab"), error: Object.assign(new Error("e"), { more: 1 }) };
for (const [name, value] of Object.entries(kinds)) console.log(name, show(both(value)), show(whole(value).length), keyOnly(value));
for (const nothing of [undefined, null]) for (const f of [both, whole, keyOnly]) try { f(nothing); console.log("no error"); } catch (e) { console.log(f.name, String(nothing), e.name + ": " + e.message); }
const getters = { get first() { log.push("get first"); delete this.third; this.added = 1; return 1; }, second: 2, get third() { log.push("get third"); return 3; }, get fourth() { log.push("get fourth"); return 4; } };
console.log(show(both(getters)), show(log.splice(0)));
const throwing = { a: 1, get b() { log.push("get b"); throw new RangeError("from b"); }, get c() { log.push("get c"); return 3; } };
try { both(throwing); } catch (e) { console.log(e.name, e.message, show(log.splice(0))); }
const proxy = new Proxy({ p: 1, q: 2, [Symbol("s")]: 3 }, { ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { log.push("get " + String(k)); return t[k]; } });
console.log(show(both(proxy)), show(log.splice(0)));
const g = generator(plain()); console.log(show([g.next(), g.next("x"), g.next(), g.next(), g.next(), g.next()]));
asynchronous({ a: Promise.resolve(1), b: 2, c: new Promise(resolve => resolve(3)) }).then(out => console.log("async", show(out)));
let sum = 0; const shapes = [plain(), { x: 1 }, { y: 1, z: 2, w: 3, v: 4, u: 5, t: 6, s: 7, r: 8 }, {}, [1, 2], { a: 1.5, b: "s" }];
for (let i = 0; i < 60000; i++) for (const [k, v] of Object.entries(shapes[i % shapes.length])) sum += k.length + (typeof v === "number" ? v : 0);
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
const kept = []; for (let i = 0; i < 30000; i++) for (const pair of Object.entries({ i, j: { i } })) if (i % 5000 === 0) kept.push(pair);
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(sum, show(kept));

// GENERATED: asynchronous b ownKeys
// CHECK-LABEL: function {{*}}name="asynchronous"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[IsExpected]}] results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectEntries
// CHECK-NEXT: v7 = Call v6, v5, v1 calleeName="Object.entries"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v9 = IteratorOpen v8
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = IteratorResume v9
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Branch v12 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v15 = IteratorOpen v13 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v16 = IteratorResume v15 stepIndex=0
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v20 = IteratorResume v15 stepIndex=1
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: IteratorClose v15
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v24 = PropGet v4 key="push"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v26 = Await v22, v1
// CHECK-NEXT: v27 = Call v25, v4, v19, v26 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v15 handler=b12():
// CHECK-NEXT: v28 = CatchException
// CHECK-NEXT: IteratorClose v15 completion=Throw
// CHECK-NEXT: Rethrow v28
// CHECK-NEXT: b12() role=IterationCleanup subject=v9:
// CHECK-NEXT: v30 = CatchException
// CHECK-NEXT: IteratorClose v9 completion=Throw
// CHECK-NEXT: Rethrow v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="get b"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="RangeError" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="from b"
// CHECK-NEXT: v10 = Construct v8, -, v9 calleeName="RangeError"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|RangeError flags=[IsExpected]}
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownKeys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="ownKeys"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v7 = Builtin builtin=Reflect
// CHECK-NEXT: v8 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}}]
// CHECK-NEXT: }
