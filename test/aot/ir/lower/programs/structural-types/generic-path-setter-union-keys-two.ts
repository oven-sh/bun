// RUN: lower
// OPTIONS: builtin-modules

// A generic path setter with union keys at two levels.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

interface Tree {
  left: { depth: number; tag: string };
  right: { depth: number; tag: string };
  meta: { depth: string; tag: number };
}

function setIn<T, A extends keyof T, B extends keyof T[A]>(target: T, a: A, b: B, value: T[A][B]): void {
  target[a][b] = value;
}

function getIn<T, A extends keyof T, B extends keyof T[A]>(target: T, a: A, b: B): T[A][B] {
  return target[a][b];
}

function depths(t: Tree): number {
  return t.left.depth + t.right.depth;
}

function tags(t: Tree): string {
  return t.left.tag.toUpperCase() + t.right.tag.toUpperCase();
}

function meta(t: Tree): string {
  return t.meta.depth.toUpperCase() + (t.meta.tag + 1);
}

const yes: boolean = process.argv.length > 0;

function fresh(): Tree {
  return { left: { depth: 1, tag: "l" }, right: { depth: 2, tag: "r" }, meta: { depth: "deep", tag: 5 } };
}

function report(title: string, t: Tree): void {
  console.log(title + ": " + JSON.stringify(t));
  attempt("  depths", () => depths(t));
  attempt("  tags", () => tags(t));
  attempt("  meta", () => meta(t));
}

let total = 0;
const warm = fresh();
for (let i = 0; i < 2000; i++) {
  setIn(warm, "left", "depth", i);
  setIn(warm, "right", "tag", "r" + (i % 3));
  setIn(warm, "meta", "tag", i);
  total += depths(warm) + tags(warm).length + meta(warm).length + getIn(warm, "left", "depth");
}
console.log("2000 honest rounds: " + total);

const a = fresh();
setIn(a, "left", yes ? "depth" : "tag", "inner union");
report("the inner key is a union", a);

const b = fresh();
setIn(b, yes ? "left" : "meta", "depth", "outer union");
report("the outer key is a union: a string into a number", b);

const c = fresh();
setIn(c, yes ? "meta" : "left", "depth", 9);
report("the outer key is a union: a number into a string", c);

const d = fresh();
setIn(d, yes ? "right" : "meta", yes ? "tag" : "depth", 3);
report("both keys are unions", d);

const e = fresh();
attempt("read with an outer union", () => {
  const value = getIn(e, yes ? "meta" : "left", "depth");
  return [typeof value, value];
});
report("never touched", e);

export {};

// GENERATED: attempt meta setIn fresh
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b11(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Error" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v13 = InstanceOf v8, v12 writtenExpression="error instanceof Error"
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v16 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="constructor"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v23 = Call v22, -, v8 calleeName="show"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Add v9, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b11(v27)
// CHECK-NEXT: b11(v28: undefined|null|string):
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = String string=" -> "
// CHECK-NEXT: v35 = Add v0, v34
// CHECK-NEXT: v36 = Add v35, v28
// CHECK-NEXT: v37 = Call v33, v31, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="meta"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="meta"
// CHECK-NEXT: v2 = PropGet v1 key="depth"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = PropGet v3 key="toUpperCase"
// CHECK-NEXT: v5 = Call v4, v3 calleeKey="toUpperCase" calleeName="t.meta.depth.toUpperCase"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = PropGet v0 key="meta"
// CHECK-NEXT: v8 = PropGet v7 key="tag"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Add v6, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setIn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]] site=[[w_16]]}, {type=undefined|null|[[L_17]] site=[[w_18]]}, {type=undefined|null|[[L_19]] site=[[w_20]]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_15]], v1: undefined|null|[[L_17]], v2: undefined|null|[[L_19]], v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = ElemGet v0, v1
// CHECK-NEXT: ElemSet v4, v2, v3
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_9]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_22]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_9]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
