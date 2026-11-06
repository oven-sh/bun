// RUN: lower
// OPTIONS: builtin-modules

// `{ ...base, ...(c ? { x: 1 } : {}) }`, `{ ...{ a, b } }`, `{ a, ...(c && { b }) }`: a literal that is written only to be spread: the keys in their order, later ones over earlier ones, and every case in which the literal is more than its written fields.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held) + " " + Object.keys(value).join();
const log = [];
const note = x => (log.push(x), x);
const base = { p: 1, q: 2 };
const cases = {
  only: (c, i) => ({ ...{ a: i, b: 2 } }),
  behindFields: (c, i) => ({ first: 0, ...{ a: i, b: 2 }, last: 9 }),
  conditional: (c, i) => ({ first: 0, ...(c ? { x: i } : {}) }),
  conditionalOrUndefined: (c, i) => ({ first: 0, ...(c ? { x: i, y: 2 } : undefined), last: 9 }),
  and: (c, i) => ({ first: 0, ...(c && { x: i }) }),
  behindObject: (c, i) => ({ ...base, ...(c ? { q: "over", r: i } : {}) }),
  aheadOfObject: (c, i) => ({ ...{ q: "under", r: i }, ...base }),
  overrides: (c, i) => ({ a: 1, b: 2, ...{ b: "over", c: i }, a: "last" }),
  twiceInLiteral: (c, i) => ({ ...{ a: 1, b: 2, a: i } }),
  two: (c, i) => ({ ...{ a: i }, ...{ b: 2 }, ...{ a: "again" } }),
  nested: (c, i) => ({ ...{ a: { ...{ b: i } } } }),
  spreadInSpread: (c, i) => ({ ...{ a: 1, ...{ b: i } } }),
  empty: (c, i) => ({ ...{} , a: i }),
  undefinedValue: (c, i) => ({ a: 1, ...{ a: undefined, b: i } }),
  order: (c, i) => ({ a: note("a"), ...{ b: note("b"), c: note("c") }, d: note("d") }),
  index: (c, i) => ({ z: 0, ...{ b: 1, 2: "two", a: 2, 1: "one" } }),
  indexInTarget: (c, i) => ({ 5: "five", ...{ b: 1 }, 3: "three" }),
  proto: (c, i) => ({ ...{ ["__proto__"]: i, a: 1 } }),
  protoSyntax: (c, i) => ({ ...{ __proto__: { inherited: 1 }, own: i } }),
  getter: (c, i) => ({ ...{ get a() { return note("got") + i; }, b: 2 } }),
  method: (c, i) => ({ ...{ m() { return i; }, a: 1 } }),
  computed: (c, i) => ({ ...{ [c ? "x" : "y"]: i, a: 1 } }),
  symbol: (c, i) => Object.getOwnPropertySymbols({ ...{ [Symbol.iterator]: i, a: 1 } }).length,
  keptToo: (c, i) => { const lit = { a: i }; const out = { ...lit, b: 2 }; lit.a = "changed"; return [out, lit]; },
  readToo: (c, i) => { const lit = { a: i, b: 2 }; return { ...lit, sum: lit.a + lit.b }; },
  storedBefore: (c, i) => { const lit = { a: i }; lit.b = 2; return { ...lit }; },
  deletedBefore: (c, i) => { const lit = { a: i, b: 2 }; delete lit.a; return { ...lit }; },
  intoItself: (c, i) => { const lit = { a: i }; return { lit, ...lit }; },
  inTry: (c, i) => { try { return { first: 0, ...(c ? { x: fails(i) } : { y: i }) }; } catch (e) { return { caught: e.message }; } },
  inLoop: (c, i) => { let out = {}; for (let j = 0; j < 3; j++) out = { ...out, ...{ ["k" + j]: j }, ...{ last: j } }; return out; },
  assign: (c, i) => Object.assign({ first: 0 }, { a: i }, c ? { b: 2 } : null),
  frozenTarget: (c, i) => { const t = Object.freeze({ a: 1 }); return { ...t, ...{ a: i } }; },
};
function fails(i) { if (i % 2) throw new Error("failed " + i); return i; }
for (const [name, f] of Object.entries(cases)) for (const c of [true, false]) console.log(name, c, show(f(c, 1)), show(f(c, 2)), log.splice(0).join());
let sum = 0; for (let i = 0; i < 150000; i++) { const o = { first: i, ...(i & 1 ? { x: i } : {}), ...(i & 2 && { y: 1, z: 2 }) }; sum += Object.keys(o).length + (o.x ?? 0); } console.log(sum);

// GENERATED: protoSyntax symbol inLoop a m
// CHECK-LABEL: function {{*}}name="protoSyntax"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: v3 = NewObject -, v1 layout=[[L_1]] fields=[0]
// CHECK-NEXT: SetLiteralPrototype v3, v2
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v6, v5
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="symbol"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectGetOwnPropertySymbols
// CHECK-NEXT: v4 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v4, v1 key=@@iterator
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: PropDefine v4, v6 key="a"
// CHECK-NEXT: v8 = FinishObject v4
// CHECK-NEXT: v9 = NewObject layout=[[L_5]]
// CHECK-NEXT: CopyDataProperties v9, v8
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Call v3, v2, v11 calleeName="Object.getOwnPropertySymbols"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|symbol> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inLoop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_7]]
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=3
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = CopyObject v5
// CHECK-NEXT: v12 = NewDictionary
// CHECK-NEXT: v13 = String string="k"
// CHECK-NEXT: v14 = Add v13, v10
// CHECK-NEXT: v15 = ToPropertyKey v14
// CHECK-NEXT: v16 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: ElemDefine v12, v15, v16
// CHECK-NEXT: CopyDataProperties v11, v12
// CHECK-NEXT: PropDefine v11, v10 key="last"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Increment v10
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v11, v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="note"
// CHECK-NEXT: v3 = String string="got"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="note"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = Add v5, v0
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
