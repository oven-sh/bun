// RUN: lower
// OPTIONS: builtin-modules

// A never check after every member of an enum is reached.
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

enum Step {
  First,
  Second,
  Third,
}

function fail(value: never): string {
  return "reached with " + show(value);
}

function bySwitch(step: Step): string {
  switch (step) {
    case Step.First:
      return "first";
    case Step.Second:
      return "second";
    case Step.Third:
      return "third";
    default:
      return fail(step);
  }
}

function byIf(step: Step): string {
  if (step === Step.First) return "first";
  if (step === Step.Second) return "second";
  if (step === Step.Third) return "third";
  const rest: never = step;
  return "rest " + show(rest);
}

function byConditional(step: Step): string {
  return step === Step.First ? "first" : step === Step.Second ? "second" : step === Step.Third ? "third" : fail(step);
}

function thrown(step: Step): string {
  switch (step) {
    case Step.First:
    case Step.Second:
    case Step.Third:
      return "known";
    default: {
      const rest: never = step;
      throw new RangeError(String(rest));
    }
  }
}

function kindOf(step: Step): string {
  switch (step) {
    case Step.First:
    case Step.Second:
    case Step.Third:
      return "known";
    default:
      return typeof step + " " + `${step}`;
  }
}

const kept: never[] = [];
function keep(step: Step): number {
  if (step === Step.First || step === Step.Second || step === Step.Third) return -1;
  return kept.push(step);
}

function inALoop(steps: Step[]): string {
  let text = "";
  for (const step of steps) {
    switch (step) {
      case Step.First:
        text += "1";
        continue;
      case Step.Second:
        text += "2";
        continue;
      case Step.Third:
        text += "3";
        continue;
    }
    const rest: never = step;
    text += "(" + show(rest) + ")";
  }
  return text;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const step: Step = i % 3;
  warm += bySwitch(step).length + byIf(step).length + byConditional(step).length + thrown(step).length + kindOf(step).length + keep(step);
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, -1, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 53, -(2 ** 31) - 1];
for (const n of numbers) {
  const step: Step = n;
  const label = show(n);
  attempt(label + " by switch", () => bySwitch(step));
  attempt(label + " by if", () => byIf(step));
  attempt(label + " by conditional", () => byConditional(step));
  attempt(label + " thrown", () => thrown(step));
  attempt(label + " kind", () => kindOf(step));
  attempt(label + " kept", () => keep(step));
}
attempt("what was kept", () => kept);
attempt("in a loop", () => {
  const steps: Step[] = [Step.First, numbers[0], Step.Third, numbers[2], numbers[4], Step.Second];
  return inALoop(steps);
});
attempt("honest again", () => [bySwitch(Step.Third), byIf(Step.Second), byConditional(Step.First), thrown(Step.First), kindOf(Step.Second)]);

// GENERATED: thrown inALoop
// CHECK-LABEL: function {{*}}name="thrown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Switch v0 cases=[0, 1, 2] -> case b1(| 0), case b2(| 0), case b3(| 0), otherwise b5()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v4 = String string="known"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="RangeError" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v0 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Construct v8, -, v11 calleeName="RangeError"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inALoop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<i32> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<i32>):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: Switch v8 cases=[0, 1, 2] -> case b5(| 0), case b6(| 0), case b7(| 0), otherwise b8()
// CHECK-NEXT: b5(v10) handler=b9():
// CHECK-NEXT: v11 = String string="1"
// CHECK-NEXT: v12 = Add v4, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v13)
// CHECK-NEXT: b6(v14) handler=b9():
// CHECK-NEXT: v15 = String string="2"
// CHECK-NEXT: v16 = Add v4, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v17)
// CHECK-NEXT: b7(v18) handler=b9():
// CHECK-NEXT: v19 = String string="3"
// CHECK-NEXT: v20 = Add v4, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v21)
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: v22 = String string="("
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v24 = Call v23, -, v8 calleeName="show"
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: v26 = String string=")"
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = Add v4, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v29)
// CHECK-NEXT: b9() role=IterationCleanup subject=v3:
// CHECK-NEXT: v30 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v30
// CHECK-NEXT: }
