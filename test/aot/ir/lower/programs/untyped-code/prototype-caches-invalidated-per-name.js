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
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.create"
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v6)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Integer integer=5
// CHECK-NEXT: v10 = Mod v1, v9
// CHECK-NEXT: v11 = LessEq v7, v10
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = String string="own"
// CHECK-NEXT: v13 = Add v12, v7
// CHECK-NEXT: ElemSet v4, v13, v7
// CHECK-NEXT: v15 = Increment v7
// CHECK-NEXT: v16 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v16)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="digest"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="objects"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1(v1)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = Call v11, -, v10 calleeName="readAll"
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v5, v14)
// CHECK-NEXT: b5(v15, v16) handler=b8():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = PropGet v12 key="length"
// CHECK-NEXT: v19 = Less v16, v18
// CHECK-NEXT: Branch v19 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v20 = Integer integer=31
// CHECK-NEXT: v21 = Mul v15, v20
// CHECK-NEXT: v22 = PropGet v12 key="charCodeAt"
// CHECK-NEXT: v23 = Call v22, v12, v16 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v24 = Add v21, v23
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = BitOr v24, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v28 = Increment v16
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v27, v29)
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: Jump -> next b1(v15)
// CHECK-NEXT: b8() role=IterationCleanup subject=v4:
// CHECK-NEXT: v30 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v30
// CHECK-NEXT: }
