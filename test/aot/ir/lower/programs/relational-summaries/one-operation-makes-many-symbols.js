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
// CHECK-NEXT: v1 = Negate v0
// CHECK-NEXT: v2 = NewObject -, v0, v1 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v0, v4
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = NewArray v0, v5, v7 contents=anything
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Greater v0, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Sub v0, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="churn"
// CHECK-NEXT: v15 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: Return v16
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="Bun" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="gc"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v22 = Boolean boolean=true
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v24 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: ReturnCall v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=Symbol
// CHECK-NEXT: v2 = String string="key"
// CHECK-NEXT: v3 = Add v2, v0
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="Symbol" callNumber=7
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keyed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]]}
// CHECK-NEXT: PropSet v4, v1 key="tag"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Keyed"
// CHECK-NEXT: v8 = PropGet v7 key="key"
// CHECK-NEXT: v9 = String string="field"
// CHECK-NEXT: ElemSet v4, v8, v9
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v13):
// CHECK-NEXT: Jump -> next b2(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=anything variableName="pair"}, {type=anything variableName="list"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="left"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = ElemGet v1, v3
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
