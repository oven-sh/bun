// `using`: what counts as a disposer, unusual resources, the order relative to closing iterators, the temporal dead zone, async generators, and a `using` at the top of a module.
using top = { [Symbol.dispose]() { console.log("the top of the module is disposed of: " + log.join(" ")); } };
const H = globalThis; let log = [];
const res = name => ({ [Symbol.dispose]() { log.push("d" + name); } });
const thr = name => ({ [Symbol.dispose]() { log.push("d" + name); throw "D" + name; } });
const show = e => e instanceof SuppressedError ? "S(" + show(e.error) + "/" + show(e.suppressed) + ")" : e instanceof Error ? e.name : e === undefined ? "undefined" : typeof e === "object" && e !== null ? "object" : typeof e === "function" ? "fn" : String(e);
function say(name, f) { log = []; let r; try { r = "-> " + show(f()); } catch (e) { r = "THROWN " + show(e); } console.log(name + ": " + r + " | " + log.join(" ")); }
class K { constructor() { log.push("K made"); } } class L extends K {}
const methods = { "a class": K, "a derived class": L, "a generator function": function* () { log.push("never"); }, "an async function": async function () { log.push("async ran"); }, "an async arrow that rejects": async () => { log.push("ran"); }, "a bound class": K.bind(null), "a proxy of a class": new Proxy(K, {}), "Map": Map, "Symbol": Symbol, "Date": Date, "Function.prototype": Function.prototype, "a bound bound function": function () { log.push("bb " + this.t); }.bind({ t: 1 }).bind({ t: 2 }), "a revoked proxy of a function": (() => { const p = Proxy.revocable(function () {}, {}); p.revoke(); return p.proxy; })(), "a method of a class": new (class { m() { log.push("m " + typeof this); } })().m, "a getter's function": Object.getOwnPropertyDescriptor({ get g() { log.push("getter ran"); return 1; } }, "g").get, "parseInt": parseInt, "an object with call": { call() {} }, "a regular expression": /x/, "a string": "s", "a symbol": Symbol.iterator, "a bigint": 1n, "NaN": NaN, "zero": 0, "false": false, "the empty string": "" };
for (const [name, method] of Object.entries(methods)) {
  say("the method is " + name, () => { using z = res("z"), a = { [Symbol.dispose]: method }; log.push("body"); return 1; });
  say("the method is " + name + ", and the body throws", () => { using a = { [Symbol.dispose]: method }; log.push("body"); throw "B"; });
}
const give = (o, name) => { o[Symbol.dispose] = function () { log.push("d" + name + " " + (this === o)); }; return o; };
const resources = { "a function": () => give(function () {}, "f"), "a class": () => give(class {}, "c"), "an arrow": () => give(() => {}, "a"), "a typed array": () => give(new Uint8Array(1), "t"), "a date": () => give(new Date(0), "d"), "a regular expression": () => give(/x/, "r"), "a promise": () => give(Promise.resolve(), "p"), "a boxed number": () => give(Object(1), "n"), "a boxed symbol": () => give(Object(Symbol()), "s"), "a boxed string": () => give(Object("s"), "S"), "an arguments object": () => give((function () { return arguments; })(), "A"), "a map": () => give(new Map(), "m"), "an error": () => give(new Error("e"), "e"), "an object without a prototype": () => give(Object.create(null), "o"), "a frozen one": () => Object.freeze(give({}, "z")), "a generator object": () => give((function* () {})(), "g"), "a bound function": () => give(function () {}.bind(null), "b"), "a revoked proxy": () => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; }, "a proxy whose get throws": () => new Proxy({}, { get() { log.push("get"); throw "G"; } }), "a proxy that yields none": () => new Proxy({}, { get() { log.push("get"); } }), "an instance of a class with a field": () => new (class { f = 1; [Symbol.dispose]() { log.push("dK " + this.f); } })(), "one whose method is inherited through three": () => Object.create(Object.create(Object.create(res("deep")))) };
for (const [name, make] of Object.entries(resources)) say("the resource is " + name, () => { using z = res("z"), a = make(); log.push("body"); return 1; });

const closing = () => ({ i: 0, [Symbol.iterator]() { return this; }, next() { log.push("next"); return { done: this.i++ > 2, value: this.i }; }, return() { log.push("closed"); return {}; } });
say("break: disposal, then the iterator is closed", () => { for (const x of closing()) { using a = res("a"); log.push("body"); break; } });
say("throw: disposal, then the iterator is closed", () => { for (const x of closing()) { using a = res("a"); throw "T"; } });
say("return: disposal, then the iterator is closed", () => { for (const x of closing()) { using a = thr("a"); return 1; } });
say("a pattern inside", () => { using a = res("a"); const [x, y] = closing(); log.push("got " + x + y); });
say("a pattern whose default throws", () => { using a = res("a"); const [x = (() => { throw "default"; })()] = { [Symbol.iterator]() { return { next() { return { done: false, value: undefined }; }, return() { log.push("closed"); return {}; } }; } }; });
say("the dead zone: its own name", () => { using a = (() => a)(); log.push("never"); });
say("the dead zone: a later name", () => { using a = res("a"), b = (() => c)(), c = res("c"); log.push("never"); });
say("the dead zone: read by disposal of an earlier one", () => { using a = { [Symbol.dispose]() { log.push("da"); return b; } }; if (H.Math) throw "early"; using b = res("b"); });
say("a closure sees it behind disposal", () => { let f; { using a = give({ v: 1 }, "a"); f = () => a.v; } return f(); });
say("disposal changes what is returned", () => { const o = give({ v: 1 }, "o"); const f = () => { using a = o; return [a.v, a]; }; const r = f(); return r[0] + "" + (r[1] === o); });
say("disposal throws in a loop, caught each turn", () => { let n = ""; for (let i = 0; i < 3; i++) { try { using a = thr("a" + i), b = i === 1 ? null : thr("b" + i); if (i === 2) throw "B"; } catch (e) { n += show(e) + ";"; } } return n; });
say("a finally around sees the error of disposal", () => { try { try { using a = thr("a"); } finally { log.push("finally"); } } catch (e) { return show(e); } });
say("a finally inside throws over the body", () => { using a = thr("a"); try { throw "B"; } finally { log.push("f"); if (H.Math) throw "F"; } });
say("a return in a finally inside", () => { using a = res("a"); try { throw "B"; } finally { if (H.Math) return "from finally"; } });
say("a break in a finally inside", () => { l: { using a = res("a"); try { throw "B"; } finally { if (H.Math) break l; } } log.push("after"); });
say("two blocks one after the other", () => { { using a = res("a"); log.push("1"); } { using b = thr("b"); log.push("2"); } log.push("never"); });
say("a block in each arm", () => [0, 1, 2].map(k => { try { if (k === 0) { using a = res("a"); return "A"; } else if (k === 1) { using b = thr("b"); return "B"; } else { using c = null; return "C"; } } catch (e) { return show(e); } }).join());
say("a conditional for the value", () => [0, 1, 2, 3].map(k => { try { using a = k === 0 ? res("x") : k === 1 ? null : k === 2 ? 5 : thr("y"); return "ok"; } catch (e) { return show(e); } }).join());
say("logical operators for the value", () => { using a = H.nothing ?? res("a"), b = H.nothing && res("never"), c = H.nothing || res("c"), d = H.nothing?.x; log.push("body"); });
say("a comma, an assignment, a call for the value", () => { let k; using a = (log.push("first"), res("a")), b = k = res("b"); log.push(String(k === b)); });
say("a generator closed while disposal throws", () => { function* g() { using a = thr("a"); yield 1; } const it = g(); it.next(); try { it.return(5); } catch (e) { return show(e) + " " + JSON.stringify(it.next()); } });
say("a generator thrown into while disposal throws", () => { function* g() { using a = thr("a"), b = thr("b"); yield 1; } const it = g(); it.next(); try { it.throw("in"); } catch (e) { return show(e); } });
say("a generator that yields in a finally inside", () => { function* g() { using a = res("a"); try { yield 1; } finally { log.push("f"); yield 2; log.push("g"); } } const it = g(); it.next(); const r = it.return(9); log.push("got " + r.value); return JSON.stringify(it.next()); });
say("yield* inside", () => { function* inner() { using i = res("i"); yield 1; yield 2; } function* g() { using a = res("a"); yield* inner(); log.push("on"); } const it = g(); it.next(); return JSON.stringify(it.return(7)); });
say("a generator's resource from what is sent", () => { function* g() { using a = yield 1; log.push("body"); using b = yield 2; } const it = g(); it.next(); it.next(res("sent")); return JSON.stringify(it.next(null)); });
const later = [];
const soon = (name, f) => later.push(async () => { log = []; let r; try { r = "-> " + show(await f()); } catch (e) { r = "THROWN " + show(e); } console.log(name + ": " + r + " | " + log.join(" ")); });
soon("async: rejected with a SuppressedError", async () => { using a = thr("a"); await null; throw "B"; });
soon("async: the value awaited", async () => { using a = await Promise.resolve(res("a")), b = await null; log.push("body"); });
soon("async: the awaited value rejects", async () => { using a = res("a"), b = await Promise.reject("R"); log.push("never"); });
soon("async: disposal returns a rejected promise, ignored", async () => { const p = Promise.reject("ignored"); p.catch(() => {}); using a = { [Symbol.dispose]() { log.push("d"); return p; } }; return 1; });
soon("an async generator", async () => { async function* g() { using a = res("a"); yield 1; await null; using b = thr("b"); yield 2; } const out = []; try { for await (const v of g()) out.push(v); } catch (e) { out.push(show(e)); } return out.join(); });
soon("an async generator, closed early", async () => { async function* g() { using a = thr("a"); yield 1; } const it = g(); await it.next(); try { await it.return(3); } catch (e) { return show(e); } });
soon("an async arrow in a loop", async () => { let n = ""; for (let i = 0; i < 3; i++) n += await (async () => { using a = res("a" + i); await null; return i; })(); return n; });
for (const f of later) await f();
log = ["the last line but one"]; console.log("done");
