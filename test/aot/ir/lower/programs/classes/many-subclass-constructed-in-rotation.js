// RUN: lower
// OPTIONS: builtin-modules

// 121 classes, one below another in many ways, are constructed in rotation with collections between; then the prototypes get a method, a setter, are frozen.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; f = 1.5; constructor(x) { this.x = x; } }
const below = (parent, i) => i % 4 === 0 ? class extends parent { } : i % 4 === 1 ? class extends parent { p = i; } : i % 4 === 2 ? class extends parent { p = i; q = "q"; r = null; s = 0.25; t = [i]; u; v = i; w = i; } : class extends parent { a = "other"; constructor(x) { super(x); this.late = x; } };
const classes = [Base];
for (let i = 0; i < 120; i++) classes.push(below(classes[i % 5 ? (i * 7) % classes.length : 0], i));
let sum = 0;
for (let turn = 0; turn < 6000; turn++) {
  const C = classes[(turn * 13 + (turn >> 5)) % classes.length];
  const made = new C(turn);
  if (Object.getPrototypeOf(made) !== C.prototype || made.x !== turn) lines.push("another prototype at " + turn);
  sum += Object.keys(made).length;
  if (turn % 1500 === 749 && typeof Bun !== "undefined") Bun.gc(true);
}
lines.push(String(sum));
for (const i of [0, 1, 2, 3, 4, 50, 119, 120]) say("class " + i, new classes[i](i));
Base.prototype.added = function () { return Object.keys(this).length; };
lines.push(String(new classes[7](1).added()));
Object.defineProperty(Base.prototype, "x", { set(v) { lines.length < 60 && lines.push("setter " + v); }, configurable: true });
say("behind a setter for x", new classes[3](5)); say("Base behind it", new Base(6));
delete Base.prototype.x;
Object.freeze(classes[2].prototype); say("frozen prototype", new classes[2](7));
Object.preventExtensions(classes[3]); say("class not extensible", new classes[3](8));
const kept = []; for (let i = 0; i < 40000; i++) { const made = new classes[1 + (i % 9)](i); if (!(i % 8000)) kept.push(made); }
for (const made of kept) say("kept", made);
console.log(lines.join("\n"));

// GENERATED: Base chain
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_3]]
// CHECK-NEXT: PropSet v4, v1 key="x"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Data data=[[d_4]]
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v5)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = ToBoolean v6
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = PropGet v1 key="push"
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v13 = String string="constructor"
// CHECK-NEXT: v14 = Call v12, v11, v6, v13 calleeName="Object.hasOwn"
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b3(| 0), notTaken b5()
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = PropGet v6 key="constructor"
// CHECK-NEXT: v18 = TypeTest v17 testedType=function
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5()
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = PropGet v6 key="constructor"
// CHECK-NEXT: v21 = PropGet v20 key="name"
// CHECK-NEXT: Jump -> next b6(v21)
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = String string="?"
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = Call v10, v1, v23 calleeKey="push" calleeName="names.push"
// CHECK-NEXT: v25 = Builtin builtin=Object
// CHECK-NEXT: v26 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v27 = Call v26, v25, v6 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: v30 = PropGet v1 key="join"
// CHECK-NEXT: v31 = String string="<"
// CHECK-NEXT: v32 = Call v30, v1, v31 calleeKey="join" calleeName="names.join"
// CHECK-NEXT: ReturnCall v32
// CHECK-NEXT: }
