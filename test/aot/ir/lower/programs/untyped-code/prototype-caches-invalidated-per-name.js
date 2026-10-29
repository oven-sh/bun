// RUN: lower
// OPTIONS: builtin-modules

// What reads by name have learnt about prototypes is forgotten name by name when a prototype changes, through many names, many shapes, many changes and collections in between.
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => { };
const roots = [];
for (let r = 0; r < 6; r++) roots.push({ tag: "root" + r });
const middles = roots.map((root, r) => Object.assign(Object.create(root), { middle: r }));
function shape(parent, k) { const o = Object.create(parent); for (let i = 0; i <= k % 5; i++) o["own" + i] = i; return o; }
const objects = [];
for (let k = 0; k < 120; k++) objects.push(shape(middles[k % middles.length], k));
function readAll(o) { return [o.tag, o.middle, o.alpha, o.beta, o.gamma, o.delta, o.epsilon, o.zeta, o.eta, o.theta].map(String).join("/"); }
function digest() { let h = 0; for (const o of objects) { const text = readAll(o); for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; } return h; }
const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const lines = [];
lines.push(digest(), digest());
for (let round = 0; round < 12; round++) {
  const name = names[round % names.length];
  const holder = round % 3 === 0 ? roots[round % roots.length] : round % 3 === 1 ? middles[round % middles.length] : objects[round * 7 % objects.length];
  holder[name] = name + round;
  lines.push(digest());
  if (round % 4 === 3) { collect(); lines.push(digest()); }
  if (round % 5 === 4) { delete roots[(round + 1) % roots.length][names[(round + 3) % names.length]]; delete middles[round % middles.length][names[(round + 6) % names.length]]; lines.push(digest()); }
  if (round % 6 === 5) { Object.setPrototypeOf(middles[round % middles.length], roots[(round + 2) % roots.length]); lines.push(digest()); }
}
for (let k = 0; k < 60; k++) objects[k] = shape(middles[(k + 1) % middles.length], k + 3);
collect();
lines.push(digest());
Object.defineProperty(roots[0], "alpha", { get() { return "got by " + (this.middle ?? this.tag); }, configurable: true });
lines.push(digest(), readAll(objects[0]), readAll(objects[6]), readAll(objects[119]));
console.log(lines.join("\n"));

// GENERATED: shape digest
// CHECK-LABEL: function {{*}}name="shape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|object flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.create"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer integer=5
// CHECK-NEXT: v12 = Mod v10, v11
// CHECK-NEXT: v13 = LessEq v8, v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = String string="own"
// CHECK-NEXT: v16 = Add v15, v14
// CHECK-NEXT: ElemSet v5, v16, v14
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v14
// CHECK-NEXT: v19 = Convert v18 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="digest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="objects"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b2(v1)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b13():
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = Call v12, -, v11 calleeName="readAll"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v5, v16)
// CHECK-NEXT: b6(v17, v18) handler=b13():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = PropGet v14 key="length"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = Less v18, v21
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23) handler=b13():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b13():
// CHECK-NEXT: v24 = Integer integer=31
// CHECK-NEXT: v25 = Mul v17, v24
// CHECK-NEXT: v26 = PropGet v14 key="charCodeAt"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v27, v14, v23 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v30 = Add v25, v29
// CHECK-NEXT: v31 = Integer
// CHECK-NEXT: v32 = BitOr v30, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b13():
// CHECK-NEXT: v34 = Increment v23
// CHECK-NEXT: v35 = Convert v34 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v33, v35)
// CHECK-NEXT: b11(v36) handler=b13():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b13():
// CHECK-NEXT: Jump -> next b2(v17)
// CHECK-NEXT: b13() role=IterationCleanup subject=v4:
// CHECK-NEXT: v37 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v37
// CHECK-NEXT: }
