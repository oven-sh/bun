// RUN: lower
// OPTIONS: builtin-modules

// Lookup keys built with `+` (`a + "," + b`) and used at once in a Map, a Set or an object (the same program without type annotations).
class Holder {
  tag;
  v;
  constructor(tag, v) {
    this.tag = tag;
    this.v = v;
  }
  get part() {
    seen.push(this.tag + ".part");
    return this.v;
  }
}
const seen = [];
function note(tag, v) {
  seen.push(tag);
  return v;
}
const long = "L".repeat(70);
const rope = "ro" + "pe".slice(0) + String(1);
const part = "a part of this".slice(2, 6);
const wide = "\u0416\u65E5";
const texts = ["a", "", "bc", long, rope, part, wide, "\xE9", "undefined", "null", undefined, null, "0", "-1"];
const numbers = [0, -0, 1, -1, 10, 2147483647, -2147483648, 4294967296, 0.5, -0.25, 1000000000000000000000, 0.0000001, NaN, 1 / 0];
const map = new Map;
const set = new Set;
const record = {};
for (const a of texts)
  for (const b of texts) {
    const k = String(a) + "," + String(b);
    map.set(k, "m:" + k);
    set.add(k);
    record[k] = "r:" + k;
  }
for (const a of texts)
  for (const n of numbers) {
    const k = String(a) + "#" + String(n);
    map.set(k, "m:" + k);
    set.add(k);
    record[k] = "r:" + k;
  }
for (const a of texts)
  for (const b of texts) {
    const k = String(a) + "/" + String(b) + "/" + String(a);
    map.set(k, "m3:" + k);
  }
let rows = 0;
let lines = 0;
function say(name, v) {
  rows++;
  const text = typeof v === "string" && v.length > 60 ? v.length + ":" + v.slice(0, 12) : String(v);
  console.log(name + " -> " + text + (seen.length ? " after " + seen.join() : ""));
  seen.length = 0;
  lines++;
}
for (let turn = 0;turn < 2; turn++) {
  for (let i = 0;i < texts.length; i++)
    for (let j = 0;j < texts.length; j++) {
      const it = { name: texts[i], other: texts[j], n: numbers[j] };
      const at = i + "," + j;
      say("get " + at, map.get(it.name + "," + it.other));
      say("has " + at, set.has(it.name + "," + it.other));
      say("record " + at, record[it.name + "," + it.other]);
      say("get three " + at, map.get(it.name + "/" + it.other + "/" + it.name));
      say("get # " + at, map.get(it.name + "#" + it.n));
      say("has # " + at, set.has(it.name + "#" + it.n));
      say("record # " + at, record[it.name + "#" + it.n]);
      say("a template " + at, map.get(`${it.name},${it.other}`));
      say("with effects " + at, map.get(note("first", it.name) + "," + note("second", it.other)));
      say("a miss " + at, map.get(it.name + ";" + it.other));
      say("number first " + at, map.get(it.n + "," + it.other));
      say("kept too " + at, (() => {
        const k = it.name + "," + it.other;
        return map.get(k) + "|" + k.length;
      })());
    }
}
function thing(tag, v) {
  return { valueOf() {
    seen.push(tag + ".valueOf");
    return v;
  }, toString() {
    seen.push(tag + ".toString");
    return "T" + tag;
  } };
}
function onlyText(tag, v) {
  return { toString() {
    seen.push(tag + ".toString");
    return v;
  } };
}
function attempt(name, f) {
  let r;
  try {
    r = f();
  } catch (e) {
    r = "throws " + e.name;
  }
  say(name, r);
}
const kinds = [["a text", () => "a"], ["a number", () => 1], ["valueOf a text", (t) => thing(t, "a")], ["valueOf a number", (t) => thing(t, 1)], ["valueOf an object", (t) => thing(t, {})], ["toString alone", (t) => onlyText(t, "bc")], ["undefined", () => {
  return;
}], ["null", () => null], ["a bigint", () => 10n], ["true", () => true]];
for (let turn = 0;turn < 2; turn++)
  for (const [x, makeX] of kinds)
    for (const [y, makeY] of kinds) {
      const a = makeX("a"), b = makeY("b"), ha = new Holder("ha", a), hb = new Holder("hb", b);
      attempt("any: " + x + " , " + y, () => map.get(a + "," + b));
      attempt("any, three: " + x + " / " + y, () => map.get(a + "/" + b + "/" + a));
      attempt("getters: " + x + " , " + y, () => map.get(ha.part + "," + hb.part));
      attempt("a template: " + x + " , " + y, () => map.get(`${a},${b}`));
      attempt("a record: " + x + " , " + y, () => record[a + "," + b]);
      attempt("a text first: " + x + " , " + y, () => set.has("a," + a + b));
    }
const nothing = [];
function beyond(a, i) {
  try {
    return String(map.get(a.name + "," + nothing[i].name));
  } catch (e) {
    return "throws " + e.name;
  }
}
say("the second holder is not there", beyond({ name: "a", other: "", n: 0 }, 3));
console.log(rows + " rows");

// GENERATED: onlyText beyond Holder valueOf
// CHECK-LABEL: function {{*}}name="onlyText"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewClosure v0, v1 function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v4, v3 key="toString"
// CHECK-NEXT: v6 = FinishObject v4
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="beyond"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]], v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v2 = Builtin builtin=String
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="map"
// CHECK-NEXT: v5 = PropGet v4 key="get"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v0 key="name"
// CHECK-NEXT: v8 = String string=","
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="nothing"
// CHECK-NEXT: v12 = ElemGet v11, v1
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="name"
// CHECK-NEXT: v15 = Add v9, v14
// CHECK-NEXT: v16 = Call v6, v4, v15 calleeKey="get" calleeName="map.get"
// CHECK-NEXT: v17 = Call v2, -, v16 calleeName="String"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = String string="throws "
// CHECK-NEXT: v21 = PropGet v19 key="name"
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v7, v1 key="tag"
// CHECK-NEXT: v9 = Convert v5 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v9, v2 key="v"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=anything}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=".valueOf"
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = Call v5, v3, v7 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
