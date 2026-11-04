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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="isDone"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="doneText"
// CHECK-NEXT: v5 = PropGet v0 key="done"
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: v7 = LogicalNot v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = Call v8, -, v0 calleeName="countOf"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v11 = Call v10, -, v0 calleeName="countIsOne"
// CHECK-NEXT: v12 = PropGet v0 key="count"
// CHECK-NEXT: v13 = BigInt digits="1"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = PropGet v0 key="zero"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v17 = Call v16, -, v0 calleeName="zeroText"
// CHECK-NEXT: v18 = PropGet v0 key="zero"
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = PropGet v0 key="empty"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v23 = Call v22, -, v0 calleeName="emptyText"
// CHECK-NEXT: v24 = PropGet v0 key="empty"
// CHECK-NEXT: v25 = PropGet v24 key="length"
// CHECK-NEXT: v26 = Builtin builtin=JSON
// CHECK-NEXT: v27 = PropGet v26 key="stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v29 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v29, v0
// CHECK-NEXT: v31 = Builtin builtin=String
// CHECK-NEXT: v32 = PropGet v0 key="count"
// CHECK-NEXT: v33 = Call v31, -, v32 calleeName="String"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string|bigint flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v29, v35 key="count"
// CHECK-NEXT: v37 = FinishObject v29
// CHECK-NEXT: v38 = Call v28, v26, v37 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v40 = NewArray v2, v4, v7, v9, v11, v14, v15, v17, v20, v21, v23, v25, v39 contents=anything
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="overwrite"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Boolean
// CHECK-NEXT: PropSet v0, v1 key="done"
// CHECK-NEXT: v3 = BigInt digits="2"
// CHECK-NEXT: v4 = BigInt digits="64"
// CHECK-NEXT: v5 = Pow v3, v4
// CHECK-NEXT: v6 = Negate v5
// CHECK-NEXT: PropSet v0, v6 key="count"
// CHECK-NEXT: v8 = Double number=0.5
// CHECK-NEXT: PropSet v0, v8 key="zero"
// CHECK-NEXT: v10 = String string="full"
// CHECK-NEXT: PropSet v0, v10 key="empty"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Task"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
