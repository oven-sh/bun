// RUN: lower
// OPTIONS: builtin-modules

// Reads through a proxy whose trap changes the world while it runs: the target, the handler, the trap itself, the proxy. Each scene is a function of its own and runs twice.
const unknown = x => x; let log = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const one = x => x === undefined ? "<undefined>" : x === null ? "<null>" : typeof x === "number" ? (x !== x ? "<NaN>" : Object.is(x, -0) ? "<-0>" : String(x)) : typeof x === "string" ? JSON.stringify(x) : typeof x === "function" ? "<function>" : typeof x === "symbol" ? String(x) : Array.isArray(x) ? "[" + x.map(one).join(", ") + "]" : typeof x === "object" ? "<object>" : String(x);
const say = (label, f) => { const all = []; for (let i = 0; i < 2; i++) { log = []; let r; try { r = one(f()); } catch (e) { r = "throws " + e.constructor.name; } all.push(r + (log.length ? " [" + log.join("; ") + "]" : "")); } console.log(label + " ==> " + (all[0] === all[1] ? all[0] : all.join(" THEN "))); };
say("scene | the trap freezes the target and lies", function s1() { const t = { k: 1 }; const p = new Proxy(t, { get() { Object.freeze(t); return 5; } }); return p.k; });
say("scene | the trap freezes the target and tells the truth", function s2() { const t = { k: 1 }; const p = new Proxy(t, { get() { Object.freeze(t); return 1; } }); return p.k; });
say("scene | the trap defines the property fast and lies", function s3() { const t = {}; const p = new Proxy(t, { get(t, k) { Object.defineProperty(t, k, { value: 1 }); return 5; } }); return p.k; });
say("scene | the trap defines another property fast", function s4() { const t = { k: 1 }; const p = new Proxy(t, { get(t) { Object.defineProperty(t, "other", { value: 1 }); return 5; } }); return [p.k, p.k, (() => { try { return p.other; } catch (e) { return e.constructor.name; } })()]; });
say("scene | the trap makes a setter alone, fast", function s5() { const t = {}; const p = new Proxy(t, { get(t, k) { Object.defineProperty(t, k, { set(v) {} }); return 5; } }); return p.k; });
say("scene | the trap revokes the proxy", function s6() { const t = { k: 1 }; const { proxy, revoke } = Proxy.revocable(t, { get() { revoke(); return 5; } }); return [proxy.k, (() => { try { return proxy.k; } catch (e) { return e.constructor.name; } })()]; });
say("scene | the trap revokes the proxy of a frozen target and lies", function s7() { const t = Object.freeze({ k: 1 }); const { proxy, revoke } = Proxy.revocable(t, { get() { revoke(); return 5; } }); return proxy.k; });
say("scene | revoked before", function s8() { const { proxy, revoke } = Proxy.revocable({ k: 1 }, { get() { return 5; } }); revoke(); return proxy.k; });
say("scene | the trap deletes itself", function s9() { const h = { get() { delete h.get; return 5; } }; const p = new Proxy({ k: 1 }, h); return [p.k, p.k, p.k]; });
say("scene | the trap puts another in its place", function s10() { const h = { get() { h.get = () => 6; return 5; } }; const p = new Proxy({ k: 1 }, h); return [p.k, p.k, p.k]; });
say("scene | the trap becomes a number", function s11() { const h = { get() { h.get = 7; return 5; } }; const p = new Proxy({ k: 1 }, h); return [p.k, (() => { try { return p.k; } catch (e) { return e.constructor.name; } })()]; });
say("scene | the trap becomes null, then undefined", function s12() { const h = { get() { h.get = null; return 5; } }; const p = new Proxy({ k: 1 }, h); const a = [p.k, p.k]; h.get = undefined; a.push(p.k); return a; });
say("scene | the trap becomes an accessor", function s13() { const h = { get() { Object.defineProperty(h, "get", { get() { log.push("asked"); return () => 8; } }); return 5; } }; const p = new Proxy({ k: 1 }, h); return [p.k, p.k, p.k]; });
say("scene | the handler gets another prototype with a trap, its own goes", function s14() { const h = { get() { delete h.get; Object.setPrototypeOf(h, { get: () => 9 }); return 5; } }; const p = new Proxy({ k: 1 }, h); return [p.k, p.k]; });
say("scene | the trap throws", function s15() { const p = new Proxy({ k: 1 }, { get() { throw new RangeError("r"); } }); return p.k; });
say("scene | the trap throws what is no error", function s16() { const p = new Proxy({ k: 1 }, { get() { throw 5; } }); try { return p.k; } catch (e) { return ["caught", e]; } });
say("scene | the trap reads the proxy again, three deep", function s17() { let depth = 0; const p = new Proxy({ k: 1 }, { get(t, k, r) { return depth++ < 3 ? r[k] + 1 : 10; } }); return p.k; });
say("scene | the trap reads the proxy for ever", function s18() { const p = new Proxy({ k: 1 }, { get(t, k, r) { return r[k]; } }); return p.k; });
say("scene | a class for a trap", function s19() { const p = new Proxy({ k: 1 }, { get: class {} }); return p.k; });
say("scene | an async function for a trap", function s20() { const p = new Proxy({ k: 1 }, { get: async () => 5 }); return p.k instanceof Promise; });
say("scene | an async function for a trap, the target frozen", function s21() { const p = new Proxy(Object.freeze({ k: 1 }), { get: async () => 1 }); return p.k; });
say("scene | a generator function for a trap", function s22() { const p = new Proxy({ k: 1 }, { get: function* () { yield 5; } }); return [...p.k]; });
say("scene | Reflect.get for a trap", function s23() { const p = new Proxy({ k: 1, get g() { return this === p; } }, { get: Reflect.get }); return [p.k, p.g, p.absent]; });
say("scene | a native function for a trap", function s24() { const p = new Proxy({ k: 1 }, { get: Math.max }); return p.k; });
say("scene | Object for a trap", function s25() { const t = { k: 1 }; const p = new Proxy(t, { get: Object }); return p.k === t; });
say("scene | String.prototype.concat for a trap", function s26() { const p = new Proxy({ k: 1 }, { get: String.prototype.concat, toString() { return "H"; } }); return p.k.slice(0, 20); });
say("scene | a trap with no parameters that looks at arguments", function s27() { const t = { k: 1 }; const p = new Proxy(t, { get() { return [arguments.length, arguments[0] === t, arguments[1], arguments[2] === p]; } }); return p.k; });
say("scene | a trap with rest parameters", function s28() { const p = new Proxy({ k: 1 }, { get: (...all) => all.length }); return p.k; });
say("scene | a trap with five parameters and defaults", function s29() { const p = new Proxy({ k: 1 }, { get: (t, k, r, d = "fourth", e) => [k, d, e] }); return p.k; });
say("scene | a trap with a pattern for the target", function s30() { const p = new Proxy({ k: 1, z: 2 }, { get: ({ z }, k) => [z, k] }); return p.k; });
say("scene | new.target in the trap", function s31() { const p = new Proxy({ k: 1 }, { get: function () { return new.target; } }); return p.k; });
say("scene | a sloppy trap's this", function s32() { const h = { get: Function("return this") }; const p = new Proxy({ k: 1 }, h); return p.k === h; });
say("scene | names that look like numbers", function s33() { const seen = []; const p = new Proxy({}, { get(t, k) { seen.push(typeof k + ":" + String(k)); return 0; } }); p[1]; p["1"]; p[-0]; p["-0"]; p[1.5]; p[1e21]; p["01"]; p[4294967295]; p[4294967294]; p[-1]; p[NaN]; p[null]; p[undefined]; p[true]; p[""]; p[" "]; p[1n]; return seen; });
say("scene | names that are objects", function s34() { const seen = []; const p = new Proxy({}, { get(t, k) { seen.push(typeof k + ":" + String(k)); return 0; } }); p[{ toString() { seen.push("toString"); return "n"; } }]; p[[1, 2]]; p[{ [Symbol.toPrimitive]() { seen.push("toPrimitive"); return Symbol.iterator; } }]; return seen; });
say("scene | symbols", function s35() { const seen = []; const p = new Proxy({}, { get(t, k) { seen.push(typeof k + ":" + String(k)); return undefined; } }); p[Symbol.iterator]; p[Symbol.for("s")]; String(Object.prototype.toString.call(p)); try { [...p]; } catch (e) { seen.push(e.constructor.name); } return seen; });
say("scene | what the language itself reads of a proxy", function s36() { const seen = []; const p = new Proxy({}, { get(t, k) { seen.push(String(k)); return undefined; } }); `${(() => { try { return String(p); } catch (e) { return e.constructor.name; } })()}`; JSON.stringify(p); Promise.resolve(p); Array.from(p); Object.assign({}, p); p instanceof Object; return seen; });
say("scene | await of a proxy", function s37() { const seen = []; const p = new Proxy({}, { get(t, k) { seen.push(String(k)); return undefined; } }); (async () => { await p; })(); return seen; });
say("scene | a method called through a proxy", function s38() { const t = { m() { return this === p ? "the proxy" : this === t ? "the target" : "other"; } }; const p = new Proxy(t, { get(t, k) { log.push(String(k)); return t[k]; } }); return [p.m(), p["m"](), p?.m?.(), (0, p.m)?.call(t)]; });
say("scene | p.k++ and its kin", function s39() { const t = { k: 1 }; const p = new Proxy(t, { get(t, k) { log.push("get " + String(k)); return t[k]; }, set(t, k, v) { log.push("set " + String(k) + " " + v); t[k] = v; return true; } }); p.k++; p.k += 2; p.k ??= 9; p.k ||= 9; p.k &&= 7; return t.k; });
say("scene | a proxy of a proxy of a proxy", function s40() { const mk = (t, n) => new Proxy(t, { get(t, k, r) { log.push(n); return Reflect.get(t, k, r); } }); const p = mk(mk(mk({ k: 1, get g() { return this === p; } }, "inner"), "middle"), "outer"); return [p.k, p.g]; });
say("scene | a proxy in the middle of a prototype chain", function s41() { const base = { k: 1, get g() { return this === o; } }; const p = new Proxy(base, { get(t, k, r) { log.push(String(k) + (r === o ? " for the heir" : " for another")); return Reflect.get(t, k, r); } }); const o = Object.create(Object.create(p)); return [o.k, o.g, o.absent]; });
say("scene | an own property hides the proxy below", function s42() { const p = new Proxy({}, { get(t, k) { log.push(String(k)); return 5; } }); const o = Object.create(p); o.k = 1; return [o.k, o.other]; });
say("scene | a class whose prototype's parent is a proxy", function s43() { const p = new Proxy({}, { get(t, k) { log.push(String(k)); return k === "m" ? () => "trapped" : undefined; } }); class K {} Object.setPrototypeOf(K.prototype, p); const k = new K(); return [k.m(), k.absent]; });
say("scene | a function target, the proxy called and read", function s44() { const p = new Proxy(function f(a, b) { return a + b; }, { get(t, k) { log.push(String(k)); return t[k]; } }); return [p(1, 2), p.length, p.name, p.call(null, 3, 4), p.bind(null, 1)(1)]; });
say("scene | an array target", function s45() { const p = new Proxy([1, 2, 3], { get(t, k, r) { log.push(String(k)); return Reflect.get(t, k, r); } }); return [p.length, p[0], p.at(-1), p.map(x => x * 2).length, [...p].length, Array.isArray(p)]; });
say("scene | the same site, a proxy then a plain object then a proxy", function s46() { const read = o => o.k; const p = new Proxy({ k: 1 }, { get: () => 5 }); const out = []; for (const o of [p, { k: 2 }, p, { a: 0, k: 3 }, Object.create({ k: 4 }), p, "s", 5, p]) out.push(read(o)); return out; });
say("scene | the same site, many proxies with handlers of many shapes", function s47() { const read = o => o.k; const out = []; for (let i = 0; i < 12; i++) { const h = {}; for (let j = 0; j < i; j++) h["x" + j] = j; h.get = () => i; out.push(read(new Proxy({}, h))); } return out; });
say("scene | the same proxy, a thousand names", function s48() { let n = 0; const p = new Proxy({}, { get(t, k) { n += k.length; return n; } }); let last; for (let i = 0; i < 1000; i++) last = p["name" + i]; return [n, last]; });
say("scene | the collector runs in the trap", function s49() { const p = new Proxy({ k: 1 }, { get(t, k) { collect(); return [k, { fresh: true }].length; } }); let s = 0; for (let i = 0; i < 5; i++) s += p["made" + "up" + i]; return s; });
say("scene | the key's text is made at run time and kept by the trap", function s50() { const kept = []; const p = new Proxy({}, { get(t, k) { kept.push(k); return 0; } }); for (let i = 0; i < 50; i++) p[unknown("a").repeat(i % 7) + i]; collect(); return kept.join("").length; });
say("scene | the target is frozen behind the stub's back by a getter of the handler's prototype", function s51() { const t = { k: 1 }; const h = Object.create({ get get() { Object.freeze(t); return () => 5; } }); return new Proxy(t, h).k; });
say("scene | the target becomes a dictionary in the trap, with the property fast", function s52() { const t = { k: 1 }; const p = new Proxy(t, { get(t, k) { for (let i = 0; i < 200; i++) t["p" + i] = i; for (let i = 0; i < 150; i++) delete t["p" + i]; Object.defineProperty(t, k, { writable: false, configurable: false }); return 5; } }); return p.k; });
say("scene | the answer is held by SameValue", function s53() { const r = []; for (const [held, answer] of [[NaN, NaN], [0, -0], [-0, 0], [-0, -0], ["a", "a"], ["ab", unknown("a") + "b"], [1n, 1n], [10n ** 30n, 10n ** 30n], [null, undefined], [undefined, null], [1, 1.0], [1, true], ["1", 1]]) { const p = new Proxy(Object.freeze({ k: held }), { get: () => answer }); try { r.push(one(p.k)); } catch (e) { r.push(e.constructor.name); } } return r; });
say("scene | a getter on the target is not run by the check", function s54() { const t = Object.defineProperty({}, "k", { get() { log.push("the getter ran"); return 1; } }); return new Proxy(t, { get: () => 5 }).k; });
say("scene | typed array targets", function s55() { const r = []; for (const [t, k] of [[new Uint8Array(2), "0"], [new Uint8Array(2), "length"], [new Uint8Array(2), "5"], [new Uint8Array(2), "-0"], [Object.freeze(new Uint8Array(0)), "0"]]) { try { r.push(new Proxy(t, { get: () => 7 })[k]); } catch (e) { r.push(e.constructor.name); } } return r; });
say("scene | String object targets by index", function s56() { const r = []; for (const k of ["0", "1", "2", "length", 0, 1, 2]) { try { r.push(new Proxy(new String("ab"), { get: () => "z" })[k]); } catch (e) { r.push(e.constructor.name); } } return r; });
say("scene | frozen array targets by index", function s57() { const r = []; for (const k of ["0", "1", "2", 0, 1, 2, "length"]) { try { r.push(new Proxy(Object.freeze([7, 8]), { get: () => 7 })[k]); } catch (e) { r.push(e.constructor.name); } } return r; });

// GENERATED: s7 s35 [Symbol.toPrimitive]
// CHECK-LABEL: function {{*}}name="s7"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.freeze"
// CHECK-NEXT: v4 = NewObject layout=[[L_2]]
// CHECK-NEXT: v5 = Builtin builtin=Proxy
// CHECK-NEXT: v6 = Builtin builtin=ProxyRevocable
// CHECK-NEXT: v7 = NewClosure v4 function=[[f_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v9, v8 key="get"
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Call v6, v5, v3, v11 calleeName="Proxy.revocable"
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined|null
// CHECK-NEXT: Branch v13 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v14):
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=NotDestructurable name="proxy"
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = PropGet v16 key="proxy"
// CHECK-NEXT: v18 = PropGet v16 key="revoke"
// CHECK-NEXT: PutEnvironmentField v4, v18 layout=[[L_2]]
// CHECK-NEXT: v20 = PropGet v17 key="k"
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="s35"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_6]]
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = Data data=[[d_7]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v5, v4 key="get"
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: v8 = Construct v1, -, v2, v7 calleeName="Proxy"
// CHECK-NEXT: v9 = PropGet v8 key=@@iterator
// CHECK-NEXT: v10 = Builtin builtin=Symbol
// CHECK-NEXT: v11 = Builtin builtin=SymbolFor
// CHECK-NEXT: v12 = String string="s"
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeName="Symbol.for"
// CHECK-NEXT: v14 = ElemGet v8, v13
// CHECK-NEXT: v15 = Builtin builtin=String
// CHECK-NEXT: v16 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v17 = PropGet v16 key="call"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v16, v8 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: v20 = Call v15, -, v19 calleeName="String"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v21 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v21, v8
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v23 = CatchValue
// CHECK-NEXT: v24 = PropGet v0 key="push"
// CHECK-NEXT: v25 = PropGet v23 key="constructor"
// CHECK-NEXT: v26 = PropGet v25 key="name"
// CHECK-NEXT: v27 = Call v24, v0, v26 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsNamedByComputedKey] captures=[{type=anything variableName="seen"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="push"
// CHECK-NEXT: v2 = String string="toPrimitive"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v4 = Builtin builtin=SymbolIterator
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
