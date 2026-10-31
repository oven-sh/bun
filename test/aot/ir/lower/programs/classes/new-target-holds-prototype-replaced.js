// RUN: lower
// OPTIONS: builtin-modules

// What new.target holds as its prototype is exchanged between two constructions, is no object, is a proxy whose traps are written down; new.target itself is a proxy, revoked or throwing; prototypes are linked anew.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; n = 0.5; constructor(x) { this.x = x; } }
class Below extends Base { d = "d"; }
function Target() { }
const construct = (callee, target, turns = 40) => again(turns, i => Reflect.construct(callee, [i], target));
const one = { tag: "one" }, two = Object.create(Below.prototype, { tag: { value: "two", enumerable: true } });
for (const callee of [Base, Below]) {
  Target.prototype = one; attempt(callee.name + " one", () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target)) === one));
  Target.prototype = two; attempt(callee.name + " two", () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target)) === two));
  Target.prototype = Below.prototype; attempt(callee.name + " the prototype of Below", () => construct(callee, Target));
  Target.prototype = Base.prototype; attempt(callee.name + " the prototype of Base", () => construct(callee, Target));
  for (const value of [null, undefined, 0, 7, "text", true, Symbol.iterator, 10n]) { Target.prototype = value; attempt(callee.name + " " + String(value), () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target, 2)) === Object.prototype)); }
  const log = [];
  Target.prototype = new Proxy(Below.prototype, { get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(t, k, d); }, has(t, k) { log.push("has " + String(k)); return Reflect.has(t, k); }, getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
  const made = construct(callee, Target, 3);
  lines.push(callee.name + " proxy as prototype: " + Reflect.ownKeys(made).join() + " | " + log.join() + " | " + (made instanceof Base));
  let reads = 0;
  const watched = new Proxy(Below, { get(t, k, r) { if (k === "prototype") reads++; return Reflect.get(t, k, r); } });
  attempt(callee.name + " proxy as new.target", () => construct(callee, watched, 5)); lines.push("prototype read " + reads);
  const revoked = Proxy.revocable(Below, {}); revoked.revoke();
  attempt(callee.name + " revoked", () => construct(callee, revoked.proxy, 1));
  const throwing = new Proxy(Below, { get(t, k, r) { if (k === "prototype") throw new RangeError("no prototype"); return Reflect.get(t, k, r); } });
  attempt(callee.name + " throwing", () => construct(callee, throwing, 1));
}
for (let i = 0; i < 200; i++) { Target.prototype = i & 1 ? one : i & 2 ? two : Below.prototype; const made = Reflect.construct(i % 3 ? Base : Below, [i], Target); if (Object.getPrototypeOf(made) !== Target.prototype) lines.push("another prototype at " + i); }
Object.setPrototypeOf(Below.prototype, one);
attempt("Below above one", () => again(40, i => new Below(i)));
Object.setPrototypeOf(Below.prototype, null);
attempt("Below above nothing", () => again(40, i => new Below(i)));
Object.setPrototypeOf(Below, function () { return { other: 1 }; });
attempt("Below with another parent", () => again(40, i => new Below(i)));
console.log(lines.join("\n"));

// GENERATED: Base Below set defineProperty has getPrototypeOf
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_3]]
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v1 key="x"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|[[L_5]], v2: undefined|null|string|symbol, v3: anything, v4: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v0 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="set "
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v2 calleeName="String"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v7, v10
// CHECK-NEXT: v12 = Call v6, v0, v11 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v13 = Builtin builtin=Reflect
// CHECK-NEXT: v14 = Builtin builtin=ReflectSet
// CHECK-NEXT: v15 = Call v14, v13, v1, v2, v3, v4 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|[[L_5]], v2: undefined|null|string|symbol, v3: undefined|null|number|string|symbol|bigint|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = PropGet v0 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="define "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v2 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Call v5, v0, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectDefineProperty
// CHECK-NEXT: v14 = Call v13, v12, v1, v2, v3 calleeName="Reflect.defineProperty"
// CHECK-NEXT: ReturnCall v14 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|[[L_5]], v2: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="has "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v2 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = Call v4, v0, v9 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v11 = Builtin builtin=Reflect
// CHECK-NEXT: v12 = Builtin builtin=ReflectHas
// CHECK-NEXT: v13 = Call v12, v11, v1, v2 calleeName="Reflect.has"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getPrototypeOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] results=[{type=undefined|null|object flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="getPrototypeOf"
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Builtin builtin=Reflect
// CHECK-NEXT: v7 = Builtin builtin=ReflectGetPrototypeOf
// CHECK-NEXT: v8 = Call v7, v6, v1 calleeName="Reflect.getPrototypeOf"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|object flags=[IsExpected]}}]
// CHECK-NEXT: }
