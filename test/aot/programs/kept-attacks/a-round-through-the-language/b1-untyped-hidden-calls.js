// A round through the language: untyped hidden calls. It prints what plain Bun prints.
function show(label, f) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", e?.name ?? String(e)); }
}
// Each function has one plain call with one kind of argument, and one call that arrives some other way.
function viaReflect(p) { return p.x + 1; }
show("reflect-0", () => viaReflect({ x: 1 }));
show("reflect-1", () => Reflect.apply(viaReflect, null, ["str"]));
function viaCall(p) { return p.x + 1; }
show("call-0", () => viaCall({ x: 1 }));
show("call-1", () => viaCall.call(null, 7));
function viaApply(p) { return p.x + 1; }
show("apply-0", () => viaApply({ x: 1 }));
show("apply-1", () => viaApply.apply(null, [[1, 2]]));
function viaBind(p, q) { return p.x + q.y; }
show("bind-0", () => viaBind({ x: 1 }, { y: 2 }));
show("bind-1", () => viaBind.bind(null, "s")(3));
show("bind-2", () => viaBind.bind(null).bind(null, { x: "a" })({ y: [] }));
function viaCallCall(p) { return p.x + 1; }
show("callcall-0", () => viaCallCall({ x: 1 }));
show("callcall-1", () => Function.prototype.call.call(viaCallCall, null, "zz"));
show("callcall-2", () => Function.prototype.apply.call(viaCallCall, null, [true]));
function viaArray(p) { return p.x + 1; }
show("array-0", () => viaArray({ x: 1 }));
show("array-1", () => [viaArray][0]("el"));
function viaObject(p) { return p.x + 1; }
show("object-0", () => viaObject({ x: 1 }));
show("object-1", () => { const o = { f: viaObject }; const k = "f"; return o[k + ""](12); });
function viaGlobal(p) { return p.x + 1; }
show("global-0", () => viaGlobal({ x: 1 }));
show("global-1", () => { globalThis.hidden = viaGlobal; return globalThis["hid" + "den"]("g"); });
function viaSort(a, b) { return a.x - b.x; }
show("sort-0", () => viaSort({ x: 1 }, { x: 2 }));
show("sort-1", () => [3, 1, 2].sort(viaSort));
function viaMap(p) { return p.x + 1; }
show("map-0", () => viaMap({ x: 1 }));
show("map-1", () => ["a", 2].map(viaMap));
function viaToString() { return this.x + "!"; }
show("tostring-0", () => viaToString.call({ x: 1 }));
show("tostring-1", () => "" + { toString: viaToString, x: { toString() { return "in"; } } });
function viaValueOf() { return this.v * 2; }
show("valueof-0", () => viaValueOf.call({ v: 2 }));
show("valueof-1", () => 1 + { valueOf: viaValueOf, v: "8" });
function viaGetter() { return this.x + 1; }
show("getter-0", () => viaGetter.call({ x: 1 }));
show("getter-1", () => Object.defineProperty({ x: "gx" }, "g", { get: viaGetter }).g);
show("getter-2", () => { const o = Object.create(Object.defineProperty({}, "g", { get: viaGetter })); return Reflect.get(o, "g", "receiver"); });
function viaSetter(v) { this.got = v.x; }
show("setter-0", () => { const o = {}; viaSetter.call(o, { x: 1 }); return o.got; });
show("setter-1", () => { const o = Object.defineProperty({}, "s", { set: viaSetter }); o.s = "sv"; return o.got; });
function viaToJSON(k) { return k.length + this.x; }
show("tojson-0", () => viaToJSON.call({ x: 1 }, "ab"));
show("tojson-1", () => JSON.stringify([{ toJSON: viaToJSON, x: "j" }]));
function viaProxy(t, k) { return t.x + k.length; }
show("proxy-0", () => viaProxy({ x: 1 }, "ab"));
show("proxy-1", () => new Proxy(function () {}, { get: viaProxy })[Symbol.iterator] === undefined);
function viaTag(s, v) { return s.x + v; }
show("tag-0", () => viaTag({ x: 1 }, 2));
show("tag-1", () => viaTag`a${"b"}c`);
function viaIter() { return { next: viaNext }; }
function viaNext(v) { return { done: true, value: v }; }
show("iter-0", () => viaNext({ x: 1 }).value.x);
show("iter-1", () => [...{ [Symbol.iterator]: viaIter }].length);
function viaThen(res, rej) { return res.x; }
show("then-0", () => viaThen({ x: 1 }, { x: 2 }));
await Promise.resolve({ then: viaThen }).then(() => 0, () => 0).constructor;
function viaNew(p) { this.v = p.x; }
show("new-0", () => new viaNew({ x: 1 }).v);
show("new-1", () => Reflect.construct(viaNew, ["c"]).v);
show("new-2", () => new (viaNew.bind(null, 5))().v);
function viaHasInstance(v) { return v.x === 1; }
show("hasinstance-0", () => viaHasInstance({ x: 1 }));
show("hasinstance-1", () => 5 instanceof { [Symbol.hasInstance]: viaHasInstance });
function viaTimer(p) { console.log("timer", String(p.x)); }
viaTimer({ x: 1 });
await new Promise((r) => setTimeout((a) => { viaTimer(a); r(); }, 0, "t"));
await new Promise((r) => { setTimeout(viaTimer, 0, 9); setTimeout(r, 1); });
