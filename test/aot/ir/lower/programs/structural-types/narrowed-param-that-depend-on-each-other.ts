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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = PropGet v1 key="pop"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="pop" calleeName="loose.pop"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|number|string flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array<undefined|null|number|string> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array<undefined|null|number|string>):
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b5():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: v9 = String string="add"
// CHECK-NEXT: v10 = StrictEq v4, v9
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Add v7, v11
// CHECK-NEXT: v13 = Integer integer=2
// CHECK-NEXT: v14 = Mul v7, v13
// CHECK-NEXT: v15 = NewArray v4, v7, v12, v14 contents=anything
// CHECK-NEXT: Return v15
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = PropGet v7 key="length"
// CHECK-NEXT: v17 = PropGet v7 key="toUpperCase"
// CHECK-NEXT: v18 = Call v17, v7 calleeKey="toUpperCase" calleeName="payload.toUpperCase"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = NewArray v4, v7, v16, v19 contents=anything
// CHECK-NEXT: Return v20
// CHECK-NEXT: b5() role=IterationCleanup subject=v1:
// CHECK-NEXT: v21 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inASwitch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|"add"|"name" flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|"add"|"name", v1: undefined|null|number|string):
// CHECK-NEXT: SwitchString v0 strings=["add", "name"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v1 key="length"
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
