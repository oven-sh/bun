// RUN: lower
// OPTIONS: builtin-modules

// Narrowed parameters that depend on each other.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Args = [kind: "add", payload: number] | [kind: "name", payload: string];

const handle: (...args: Args) => unknown = (kind, payload) => {
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
};

function declared(...args: Args): unknown {
  const [kind, payload] = args;
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
}

function byIndex(...args: Args): unknown {
  if (args[0] === "add") return [args[0], args[1], args[1] + 1];
  return [args[0], args[1], args[1].length];
}

const inASwitch: (...args: Args) => unknown = (kind, payload) => {
  switch (kind) {
    case "add":
      return payload + 1;
    case "name":
      return payload.length;
  }
};

const all: [string, (...args: Args) => unknown][] = [
  ["an arrow function", handle],
  ["a rest parameter taken apart", declared],
  ["a rest parameter read by index", byIndex],
  ["a switch", inASwitch],
];

function mixedUp(kind: "add" | "name"): Args {
  const args: Args = kind === "add" ? ["add", 1] : ["name", "n"];
  const loose: (string | number)[] = args;
  loose[1] = kind === "add" ? "text" : 5;
  return args;
}

function short(): Args {
  const args: Args = ["add", 1];
  const loose: (string | number)[] = args;
  loose.pop();
  return args;
}

for (const [name, f] of all) attempt("honest: " + name, () => [f("add", 1), f("name", "n")]);
for (let i = 0; i < 2000; i++) for (const [, f] of all) i % 2 === 0 ? f("add", i) : f("name", "n");
for (const [name, f] of all) {
  attempt("add with a string: " + name, () => f(...mixedUp("add")));
  attempt("name with a number: " + name, () => f(...mixedUp("name")));
  attempt("add with nothing: " + name, () => f(...short()));
  attempt("through apply: " + name, () => f.apply(undefined, mixedUp("add")));
}
for (const [name, f] of all) attempt("honest again: " + name, () => [f("add", 1), f("name", "n")]);

// GENERATED: short declared inASwitch
// CHECK-LABEL: function {{*}}name="short"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|number|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_2]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<undefined|null|number|"add">} illTypedCause=Assertion
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = PropGet v3 key="pop"
// CHECK-NEXT: v5 = Call v4, v3 calleeKey="pop" calleeName="args.pop"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|number|string site=[[w_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = Convert v2 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array<undefined|null|number|string> site=[[w_6]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: Array<undefined|null|number|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b11():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"add"|"name" site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b11():
// CHECK-NEXT: v6 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b11():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = String string="add"
// CHECK-NEXT: v12 = StrictEq v5, v11
// CHECK-NEXT: Branch v12 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v13):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v14 = Convert v9 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Integer integer=2
// CHECK-NEXT: v18 = Mul v14, v17
// CHECK-NEXT: v19 = NewArray v13, v14, v16, v18 contents=anything
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v21 = Convert v9 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v22 = PropGet v21 key="length"
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v24 = PropGet v21 key="toUpperCase"
// CHECK-NEXT: v25 = Call v24, v21 calleeKey="toUpperCase" calleeName="payload.toUpperCase"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = NewArray v20, v21, v23, v26 contents=anything
// CHECK-NEXT: Return v27
// CHECK-NEXT: b11() role=IterationCleanup subject=v1:
// CHECK-NEXT: v28 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inASwitch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|"add"|"name" site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|"add"|"name", v1: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["add", "name"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v1 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Convert v1 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_13]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
