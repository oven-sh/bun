// RUN: lower
// OPTIONS: builtin-modules

// Read only tuples of literals are changed by reflection.
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

type Pair = readonly [1, "one"];
type Flags = readonly [true, false];

function numberOf(pair: Pair): 1 {
  return pair[0];
}
function textOf(pair: Pair): "one" {
  return pair[1];
}
function sumOf(pair: Pair): number {
  return pair[0] + pair[1].length + pair.length;
}
function both(flags: Flags): string {
  return (flags[0] ? "yes" : "no") + (flags[1] ? "yes" : "no");
}
function spreadOf(pair: Pair): unknown[] {
  const [first, second] = pair;
  return [first, second, [...pair]];
}

let warm = 0;
const honest: Pair = [1, "one"];
for (let i = 0; i < 2000; i++) warm += numberOf(honest) + textOf(honest).length + sumOf(honest);
console.log("2000 honest rounds", warm);

attempt("Reflect.set of the number", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, 0, 2.5);
  return [numberOf(pair), numberOf(pair) === 1, sumOf(pair), spreadOf(pair)];
});
attempt("Reflect.set of the text", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, 1, "fifteen");
  return [textOf(pair), textOf(pair) === "one", sumOf(pair), spreadOf(pair)];
});
attempt("the two change places", () => {
  const pair: Pair = [1, "one"];
  Object.assign(pair, { 0: "one", 1: 1 });
  return [numberOf(pair), textOf(pair), typeof numberOf(pair), spreadOf(pair)];
});
attempt("the two change places and are used", () => {
  const pair: Pair = [1, "one"];
  Object.assign(pair, { 0: "one", 1: 1 });
  return sumOf(pair);
});
attempt("the length is cut", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 1);
  return [pair.length, textOf(pair), spreadOf(pair)];
});
attempt("the length is cut and the text is used", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 1);
  return sumOf(pair);
});
attempt("the length is raised", () => {
  const pair: Pair = [1, "one"];
  Reflect.set(pair, "length", 4);
  return [pair.length, sumOf(pair), spreadOf(pair)];
});
attempt("flags are flipped", () => {
  const flags: Flags = [true, false];
  Reflect.set(flags, 0, false);
  Reflect.set(flags, 1, true);
  return [both(flags), flags[0] === true, flags];
});
attempt("sorted through a wider name", () => {
  const list: [3, 1, 2] = [3, 1, 2];
  const wide: number[] = list;
  wide.sort();
  const first: 3 = list[0];
  return [first, first === 3, list];
});
attempt("honest again", () => [numberOf(honest), textOf(honest), sumOf(honest), both([true, false])]);

// GENERATED: spreadOf attempt
// CHECK-LABEL: function {{*}}name="spreadOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|1|"one"> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|1|"one">):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = Convert v4 declared={type=1} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v6 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|"one" site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v11, v0
// CHECK-NEXT: v13 = NewArray v5, v9, v11 contents=anything
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: b7() role=IterationCleanup subject=v1:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Call v6, v4, v0, v7, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="threw"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="Error" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v23 = InstanceOf v13, v22 writtenExpression="error instanceof Error"
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="constructor"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = TypeOf v13
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v18, v16, v0, v19, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
