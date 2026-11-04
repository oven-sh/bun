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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|1|"one"> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|1|"one">):
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: v9 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v9, v0
// CHECK-NEXT: v11 = NewArray v4, v7, v9 contents=anything
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3() role=IterationCleanup subject=v1:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Call v6, v4, v0, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v12 = CatchValue
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="threw"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="Error" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v22 = InstanceOf v12, v21
// CHECK-NEXT: v23 = ToBoolean v22
// CHECK-NEXT: Branch v23 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v24):
// CHECK-NEXT: v25 = PropGet v12 key="constructor"
// CHECK-NEXT: v26 = PropGet v25 key="name"
// CHECK-NEXT: Jump -> next b5(v26)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: v28 = TypeOf v12
// CHECK-NEXT: Jump -> next b5(v28)
// CHECK-NEXT: b5(v29):
// CHECK-NEXT: v30 = Call v17, v15, v0, v18, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
