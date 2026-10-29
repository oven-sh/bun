// RUN: lower
// OPTIONS: builtin-modules

// Boolean and bigint literal members are stored over.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Done {
  done: true;
  count: 1n;
  zero: 0;
  empty: "";
}

function isDone(state: Done): true {
  return state.done;
}
function doneText(state: Done): string {
  return state.done ? "done" : "not done";
}
function countOf(state: Done): 1n {
  return state.count;
}
function countIsOne(state: Done): boolean {
  return state.count === 1n;
}
function zeroText(state: Done): string {
  return state.zero ? "not zero" : "zero";
}
function emptyText(state: Done): string {
  return state.empty || "empty";
}
function look(state: Done): unknown[] {
  return [isDone(state), doneText(state), !state.done, countOf(state), countIsOne(state), state.count + 1n, state.zero, zeroText(state), state.zero + 1, state.empty, emptyText(state), state.empty.length, JSON.stringify({ ...state, count: String(state.count) })];
}
function make(): Done {
  return { done: true, count: 1n, zero: 0, empty: "" };
}

class Task implements Done {
  done: true = true;
  count: 1n = 1n;
  zero: 0 = 0;
  empty: "" = "";
}

interface Wide {
  done: boolean;
  count: bigint;
  zero: number;
  empty: string;
}
function overwrite(wide: Wide): void {
  wide.done = false;
  wide.count = -(2n ** 64n);
  wide.zero = 0.5;
  wide.empty = "full";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += look(i % 2 ? make() : new Task()).length;
console.log("2000 honest rounds", warm);

attempt("a literal before", () => look(make()));
attempt("a literal after", () => {
  const state = make();
  overwrite(state);
  return look(state);
});
attempt("an instance before", () => look(new Task()));
attempt("an instance after", () => {
  const task = new Task();
  overwrite(task);
  return look(task);
});
attempt("elements", () => {
  const yes: true[] = [true, true];
  const wide: boolean[] = yes;
  wide[1] = false;
  const ones: 1n[] = [1n];
  const wideOnes: bigint[] = ones;
  wideOnes.push(0n);
  return [yes, yes.every(flag => flag), yes.map(flag => (flag ? 1 : 0)), ones, ones.map(one => one === 1n), ones.map(one => (one ? "truthy" : "falsy"))];
});
attempt("negative zero for zero", () => {
  const state = make();
  const wide: Wide = state;
  wide.zero = -0;
  return [state.zero, 1 / state.zero, state.zero === 0, Object.is(state.zero, 0), zeroText(state)];
});

// GENERATED: look overwrite Task
// CHECK-LABEL: function {{*}}name="look"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="isDone"
// CHECK-NEXT: v3 = Convert v2 declared={type=true site=[[w_5]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v5 = Call v4, -, v0 calleeName="doneText"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v0 key="done"
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: v9 = LogicalNot v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v11 = Call v10, -, v0 calleeName="countOf"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|bigint site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v14 = Call v13, -, v0 calleeName="countIsOne"
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean site=[[w_11]]}
// CHECK-NEXT: v16 = PropGet v0 key="count"
// CHECK-NEXT: v17 = BigInt digits="1"
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: v19 = PropGet v0 key="zero"
// CHECK-NEXT: v20 = Convert v19 declared={type=0 site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v22 = Call v21, -, v0 calleeName="zeroText"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v24 = PropGet v0 key="zero"
// CHECK-NEXT: v25 = Convert v24 declared={type=0 site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = PropGet v0 key="empty"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v30 = Call v29, -, v0 calleeName="emptyText"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v32 = PropGet v0 key="empty"
// CHECK-NEXT: v33 = PropGet v32 key="length"
// CHECK-NEXT: v34 = Convert v33 declared={type=number site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v35 = Builtin builtin=JSON
// CHECK-NEXT: v36 = PropGet v35 key="stringify"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v38 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v38, v0
// CHECK-NEXT: v40 = Builtin builtin=String
// CHECK-NEXT: v41 = PropGet v0 key="count"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|bigint site=[[w_19]]} illTypedCause=Assertion
// CHECK-NEXT: v43 = Call v40, -, v42 calleeName="String"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string|bigint flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v38, v45 key="count"
// CHECK-NEXT: v47 = FinishObject v38
// CHECK-NEXT: v48 = Call v37, v35, v47 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v50 = NewArray v3, v6, v9, v12, v15, v18, v20, v23, v27, v28, v31, v34, v49 contents=anything
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|Array site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v51
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="overwrite"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean site=[[w_23]]}
// CHECK-NEXT: PropSet v0, v2 key="done"
// CHECK-NEXT: v4 = BigInt digits="2"
// CHECK-NEXT: v5 = BigInt digits="64"
// CHECK-NEXT: v6 = Pow v4, v5
// CHECK-NEXT: v7 = Negate v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|bigint site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v8 key="count"
// CHECK-NEXT: v10 = Double number=0.5
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_25]]}
// CHECK-NEXT: PropSet v0, v11 key="zero"
// CHECK-NEXT: v13 = String string="full"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v14 key="empty"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Task"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_27]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_27]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_27]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_28]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
