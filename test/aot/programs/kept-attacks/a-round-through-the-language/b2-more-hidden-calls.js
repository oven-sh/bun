// A round through the language: more hidden calls. It prints what plain Bun prints.
function show(label, f) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", e?.name ?? String(e)); }
}
const O = { x: 1 };
// Each function is called once in the open with { x: 1 } (or on it), then reached some other way.
class ViaConstructorProperty { constructor(p) { this.v = p.x; } }
show("ctorprop-0", () => new ViaConstructorProperty(O).v);
show("ctorprop-1", () => new (new ViaConstructorProperty(O).constructor)("s").v);
class ViaParent { constructor(p) { this.v = p.x; } }
class ViaChild extends ViaParent { constructor() { super(O); } }
show("parent-0", () => new ViaChild().v);
show("parent-1", () => new (Object.getPrototypeOf(ViaChild))(5).v);
class ViaNames { m(p) { return p.x; } }
show("names-0", () => new ViaNames().m(O));
show("names-1", () => Object.getOwnPropertyNames(ViaNames.prototype).map((k) => k === "constructor" ? "c" : ViaNames.prototype[k]("n")));
function viaValues(p) { return p.x; }
show("values-0", () => viaValues(O));
show("values-1", () => Object.values({ viaValues }).map((f) => f("v")));
function viaEntries(p) { return p.x; }
show("entries-0", () => viaEntries(O));
show("entries-1", () => Object.entries({ viaEntries }).map(([, f]) => f(1)));
function viaForIn(p) { return p.x; }
show("forin-0", () => viaForIn(O));
show("forin-1", () => { const h = { viaForIn }; let r; for (const k in h) r = h[k](true); return r; });
function viaLookupGetter() { return this.x; }
show("lookup-0", () => viaLookupGetter.call(O));
show("lookup-1", () => Object.defineProperty({}, "g", { get: viaLookupGetter, configurable: true }).__lookupGetter__("g").call("LG"));
function viaDescriptors() { return this.x; }
show("descs-0", () => viaDescriptors.call(O));
show("descs-1", () => Object.getOwnPropertyDescriptors(Object.defineProperty({}, "g", { get: viaDescriptors, enumerable: true })).g.get.call(3));
function viaStringProto() { return typeof this + this.x; }
show("strproto-0", () => viaStringProto.call(O));
show("strproto-1", () => { String.prototype.viaSP = viaStringProto; const r = "abc".viaSP(); delete String.prototype.viaSP; return r; });
function viaNumberGetter() { "use strict"; return typeof this + this.x; }
show("numgetter-0", () => viaNumberGetter.call(O));
show("numgetter-1", () => { Object.defineProperty(Number.prototype, "viaNG", { get: viaNumberGetter, configurable: true }); const r = (5).viaNG; delete Number.prototype.viaNG; return r; });
class ViaSpecies extends Array { constructor(n) { super(typeof n === "number" ? n : 0); this.seen = typeof n; } }
show("species-0", () => new ViaSpecies(O).seen);
show("species-1", () => new ViaSpecies(O).map((v) => v).seen);
show("species-2", () => ViaSpecies.from([1, 2]).seen + ViaSpecies.of(1, 2, 3).seen);
class ViaPromise extends Promise { constructor(ex) { super(typeof ex === "function" ? ex : (r) => r(ex.x)); ViaPromise.seen = typeof ex; } }
show("promise-0", () => { new ViaPromise(O); return ViaPromise.seen; });
show("promise-1", () => { new ViaPromise(O).then(() => 0); return ViaPromise.seen; });
function viaExecutor(res, rej) { return res.x; }
show("executor-0", () => viaExecutor(O, O));
show("executor-1", () => typeof new Promise(viaExecutor));
function viaFinally(v) { console.log("finally", arguments.length, String(v)); }
viaFinally(O.x);
await Promise.resolve(1).finally(viaFinally);
function viaReplacer(k, v) { return k.x === 1 ? "open" : v; }
show("replacer-0", () => viaReplacer(O, 1));
show("replacer-1", () => JSON.stringify({ a: 1 }, viaReplacer));
function viaReplaceAll(m) { return m.x + "!"; }
show("replaceall-0", () => viaReplaceAll(O));
show("replaceall-1", () => "a-a".replaceAll("a", viaReplaceAll));
function viaGroupBy(v) { return v.x; }
show("groupby-0", () => viaGroupBy(O));
show("groupby-1", () => Object.keys(Object.groupBy([1, "s"], viaGroupBy)));
show("groupby-2", () => Map.groupBy([null === 0, 2n], viaGroupBy).size);
function viaTypedMap(v) { return v.x === undefined ? v + 1 : -1; }
show("typedmap-0", () => viaTypedMap(O));
show("typedmap-1", () => new Uint8Array([1, 2]).map(viaTypedMap));
function viaToSorted(a, b) { return a.x === undefined ? a - b : 0; }
show("tosorted-0", () => viaToSorted(O, O));
show("tosorted-1", () => [3, 1, 2].toSorted(viaToSorted));
function viaExec(s) { return s.x === undefined ? null : [1]; }
show("exec-0", () => viaExec(O));
show("exec-1", () => { const r = /a/; r.exec = viaExec; return r.test("aaa"); });
function viaSplit(s, l) { return [typeof s, typeof l, s.x]; }
show("split-0", () => viaSplit(O, O));
show("split-1", () => "a,b".split({ [Symbol.split]: viaSplit }, 3));
function viaMatch(s) { return typeof s + s.x; }
show("match-0", () => viaMatch(O));
show("match-1", () => "zz".match({ [Symbol.match]: viaMatch }));
function viaJoin(sep) { return "joined" + typeof sep + this.x; }
show("join-0", () => viaJoin.call(O, O));
show("join-1", () => Array.prototype.toString.call({ join: viaJoin, x: "J" }));
function viaToISO() { return "iso" + this.x; }
show("toiso-0", () => viaToISO.call(O));
show("toiso-1", () => Date.prototype.toJSON.call({ toISOString: viaToISO, x: "D" }));
function viaLocale() { return "loc" + this.x; }
show("locale-0", () => viaLocale.call(O));
show("locale-1", () => Object.prototype.toLocaleString.call({ toString: viaLocale, x: "L" }));
function viaPushSetter(v) { this.got = typeof v + v.x; }
show("pushset-0", () => { const t = {}; viaPushSetter.call(t, O); return t.got; });
show("pushset-1", () => { const t = Object.defineProperty({ length: 0 }, "0", { set: viaPushSetter }); Array.prototype.push.call(t, "pushed"); return t.got; });
function viaAssignSetter(v) { this.got = typeof v + v.x; }
show("assignset-0", () => { const t = {}; viaAssignSetter.call(t, O); return t.got; });
show("assignset-1", () => { const t = Object.defineProperty({}, "k", { set: viaAssignSetter }); Object.assign(t, { k: 12 }); return t.got; });
function viaSpreadGetter() { return typeof this + this.x; }
show("spreadget-0", () => viaSpreadGetter.call(O));
show("spreadget-1", () => ({ ...Object.defineProperty({ x: "SG" }, "g", { get: viaSpreadGetter, enumerable: true }) }).g);
function viaReflectSet(v) { this.got = typeof this + typeof v; }
show("reflectset-0", () => { const t = { x: 1 }; viaReflectSet.call(t, O); return t.got; });
show("reflectset-1", () => { const r = []; Reflect.set(Object.defineProperty({}, "k", { set: viaReflectSet }), "k", 1, r); return r.got; });
function viaApplyTrap(t, th, args) { return typeof t + typeof th + args.x; }
show("applytrap-0", () => viaApplyTrap(O, O, O));
show("applytrap-1", () => new Proxy(function () {}, { apply: viaApplyTrap })(1, 2));
function viaConstructTrap(t, args, nt) { return { r: typeof t + args.x + typeof nt }; }
show("constructtrap-0", () => viaConstructTrap(O, O, O).r);
show("constructtrap-1", () => new (new Proxy(function () {}, { construct: viaConstructTrap }))(1).r);
function viaHasTrap(t, k) { return k.x === undefined; }
show("hastrap-0", () => viaHasTrap(O, O));
show("hastrap-1", () => "k" in new Proxy({}, { has: viaHasTrap }));
function viaReturn(v) { console.log("return", arguments.length, typeof v); return {}; }
viaReturn(O);
for (const v of { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return: viaReturn }; } }) break;
function viaDispose() { console.log("dispose", typeof this, String(this.x)); }
viaDispose.call(O);
{ using d = { [Symbol.dispose]: viaDispose, x: "disp" }; }
function viaToPrimitive(hint) { return hint.x === undefined ? hint.length : -1; }
show("toprim-0", () => viaToPrimitive(O));
show("toprim-1", () => `${{ [Symbol.toPrimitive]: viaToPrimitive }}` + +{ [Symbol.toPrimitive]: viaToPrimitive });
function viaMicrotask() { console.log("microtask", arguments.length, typeof this); }
viaMicrotask.call(O, O);
queueMicrotask(viaMicrotask);
await null;
function viaNextTick(a, b) { console.log("tick", typeof a, typeof b, String(a.x)); }
viaNextTick(O, O);
process.nextTick(viaNextTick, "t", 2);
await new Promise((r) => setImmediate(r));
function viaImmediate(a) { console.log("immediate", typeof a, String(a.x)); }
viaImmediate(O);
await new Promise((r) => { setImmediate(viaImmediate, 4); setImmediate(r); });
function viaRegistry(h) { return h.x; }
show("registry-0", () => viaRegistry(O));
show("registry-1", () => typeof new FinalizationRegistry(viaRegistry));
function viaFromAsync(v) { return typeof v + v.x; }
show("fromasync-0", () => viaFromAsync(O));
console.log("fromasync-1", String(await Array.fromAsync([1, "a"], viaFromAsync)));
function viaIterMap(v) { return typeof v + v.x; }
show("itermap-0", () => viaIterMap(O));
show("itermap-1", () => [1, "b"].values().map(viaIterMap).toArray());
function viaWeakRef(p) { return p.x; }
show("weakref-0", () => viaWeakRef(O));
show("weakref-1", () => new WeakRef(viaWeakRef).deref()("wr"));
function viaMapValue(p) { return p.x; }
show("mapvalue-0", () => viaMapValue(O));
show("mapvalue-1", () => new Map([["k", viaMapValue]]).get("k")("mv"));
show("mapvalue-2", () => [...new Set([viaMapValue])][0](0));
function viaSymbolKey(p) { return p.x; }
show("symkey-0", () => viaSymbolKey(O));
show("symkey-1", () => { const s = Symbol(); const h = { [s]: viaSymbolKey }; return h[Object.getOwnPropertySymbols(h)[0]]("sk"); });
function viaStructured(p) { return p.x; }
show("emitter-0", () => viaStructured(O));
const { EventEmitter } = await import("node:events");
show("emitter-1", () => { const e = new EventEmitter(); let r; e.on("x", (v) => { r = viaStructured(v); }); e.on("y", viaStructured); e.emit("x", "ev"); e.emit("y", 7); return r; });
const target = new EventTarget();
function viaListener(ev) { console.log("listener", typeof ev, String(ev.x), ev.type); }
viaListener({ x: 1, type: "open" });
target.addEventListener("ping", viaListener);
target.dispatchEvent(new Event("ping"));
