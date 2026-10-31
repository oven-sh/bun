// RUN: lower
// OPTIONS: builtin-modules

// `Symbol()` in a loop or in a function makes another key each time, and all of them are written at one place in the program. What holds under one of these keys (a field that every object has, a plain value) does not hold under the next (nothing, an accessor that keeps `this`).
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+") || "nobody";
const makeKey = i => Symbol("key" + i);
const keys = [];
for (let i = 0; i < 4; i++) keys.push(makeKey(i));
const readUnder = (thing, key) => thing[key];
const storeUnder = (thing, key, value) => {
  thing[key] = value;
  return thing[key];
};
const above = {
  get [keys[2]]() {
    kept.push(this);
    return "getter above";
  },
  set [keys[2]](value) {
    kept.push(this);
  },
};
function make(tag) {
  const thing = { __proto__: tag.startsWith("below") ? above : Object.prototype, tag, [keys[0]]: "plain" };
  if (tag.endsWith("own"))
    Object.defineProperty(thing, keys[1], {
      get() {
        kept.push(this);
        return "own getter";
      },
      set(value) {
        kept.push(this);
      },
    });
  return thing;
}
const lines = [];
for (const tag of ["flat", "flat own", "below", "below own"]) {
  for (let i = 0; i < keys.length; i++) {
    lines.push(tag + " read " + i + " " + String(readUnder(make(tag), keys[i])));
    churn(20);
    lines.push(report());
    lines.push(tag + " store " + i + " " + String(storeUnder(make(tag), keys[i], "stored")));
    churn(20);
    lines.push(report());
  }
}
class Keyed {
  static key = makeKey(9);
  constructor(tag) {
    this.tag = tag;
    this[Keyed.key] = "field";
  }
}
lines.push(readUnder(new Keyed("keyed"), Keyed.key), String(readUnder(new Keyed("keyed"), keys[2])));
Object.defineProperty(Keyed.prototype, keys[3], Object.getOwnPropertyDescriptor(above, keys[2]));
lines.push(readUnder(new Keyed("keyed below"), keys[3]), readUnder(new Keyed("keyed"), Keyed.key));
churn(20);
lines.push(report());
console.log(lines.join("\n"));

// GENERATED: churn makeKey Keyed read
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Negate v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject -, v1 layout=[[L_1]] fields=[0]
// CHECK-NEXT: PropDefine v4, v3 key="right"
// CHECK-NEXT: v6 = FinishObject v4
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = Add v1, v10
// CHECK-NEXT: v12 = NewArray v1, v9, v11 contents=anything
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v14 = NewClosure v7, v13 function=[[f_2]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Greater v1, v16
// CHECK-NEXT: Branch v17 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v18):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v20 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = Sub v20, v21
// CHECK-NEXT: v23 = Call v19, -, v22 calleeName="churn"
// CHECK-NEXT: v24 = Call v15 calleeName="read"
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: Return v25
// CHECK-NEXT: b4(v26):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="Bun" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="gc"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v32 = Boolean boolean=true
// CHECK-NEXT: v33 = Call v31, v29, v32 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v34 = Call v15 calleeName="read"
// CHECK-NEXT: ReturnCall v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|symbol flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Symbol
// CHECK-NEXT: v2 = String string="key"
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Call v1, -, v4 calleeName="Symbol" callNumber=7
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|symbol flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keyed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="tag"
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="Keyed"
// CHECK-NEXT: v10 = PropGet v9 key="key"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|symbol flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="field"
// CHECK-NEXT: ElemSet v7, v11, v12
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="left"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = ElemGet v1, v3
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
