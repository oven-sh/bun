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
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_5]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v6 = Call v5, v4, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = ToBoolean v8
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b14(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = PropGet v3 key="push"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=Object
// CHECK-NEXT: v15 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v16 = String string="constructor"
// CHECK-NEXT: v17 = Call v15, v14, v11, v16 calleeName="Object.hasOwn"
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v19 = ToBoolean v18
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b10(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = PropGet v11 key="constructor"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v23 = TypeTest v22 testedType=function
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v25 = PropGet v11 key="constructor"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="name"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b12(v28)
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b10(v30):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v31 = String string="?"
// CHECK-NEXT: Jump -> next b12(v31)
// CHECK-NEXT: b12(v32):
// CHECK-NEXT: v33 = Call v13, v3, v32 calleeKey="push" calleeName="names.push"
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v34 = Builtin builtin=Object
// CHECK-NEXT: v35 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v36 = Call v35, v34, v11 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v37)
// CHECK-NEXT: b14(v38):
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v39 = PropGet v3 key="join"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v41 = String string="<"
// CHECK-NEXT: v42 = Call v40, v3, v41 calleeKey="join" calleeName="names.join"
// CHECK-NEXT: ReturnCall v42 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
