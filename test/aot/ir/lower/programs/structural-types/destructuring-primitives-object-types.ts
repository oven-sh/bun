// RUN: lower
// OPTIONS: builtin-modules

// Destructuring primitives under object types.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

type HasLength = { length: number };

function inTheParameter({ length }: HasLength): number {
  return length;
}

function renamed({ length: size }: HasLength): number {
  return size + 1;
}

function inTheBody(item: HasLength): number {
  const { length } = item;
  return length;
}

function withADefault({ length = -1 }: { length?: number }): number {
  return length;
}

function withRest(item: HasLength): [number, string[]] {
  const { length, ...others } = item;
  return [length, Object.keys(others)];
}

function assigned(item: HasLength): number {
  let length = 0;
  ({ length } = item);
  return length;
}

function nested({ item: { length } }: { item: HasLength }): number {
  return length;
}

function fromAList([first, second]: HasLength[]): number[] {
  return [first.length, second.length];
}

function inAForOf(items: HasLength[]): number {
  let total = 0;
  for (const { length } of items) total += length;
  return total;
}

function method({ toFixed }: { toFixed(digits: number): string }): string {
  return typeof toFixed + " " + toFixed.name;
}

function computed(item: HasLength, key: "length"): number {
  const { [key]: value } = item;
  return value;
}

const values: [string, HasLength][] = [
  ["literal", { length: 4 }],
  ["string", "hello"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function", inTheBody],
  ["typed array", new Uint8Array(3)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += inTheParameter(honest) + renamed(honest) + inTheBody(honest) + withADefault(honest) + withRest(honest)[0] + assigned(honest);
  warm += nested({ item: honest }) + fromAList([honest, honest])[1] + inAForOf([honest]) + computed(honest, "length");
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": in the parameter", () => inTheParameter(value));
  attempt(name + ": renamed", () => renamed(value));
  attempt(name + ": in the body", () => inTheBody(value));
  attempt(name + ": with rest", () => withRest(value));
  attempt(name + ": assigned", () => assigned(value));
  attempt(name + ": nested", () => nested({ item: value }));
  attempt(name + ": from a list", () => fromAList([value, { length: 0 }]));
  attempt(name + ": in a for-of", () => inAForOf([{ length: 1 }, value, value]));
  attempt(name + ": by a computed key", () => computed(value, "length"));
}
attempt("a default that is not needed", () => [withADefault("abc"), withADefault(""), withADefault([]), withADefault({}), withADefault({ length: undefined })]);
attempt("a method of a number", () => [method(1), method(0.5), method({ toFixed: () => "" })]);
attempt("an empty pattern", () => {
  const take = ({}: {}) => "taken";
  return [take(0), take(""), take(false), take({})];
});

// GENERATED: withRest fromAList computed toFixed
// CHECK-LABEL: function {{*}}name="withRest"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|number|Array<undefined|null|string>> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="length"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = CopyObject v4 excludedKeys=["length"]
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = Call v8, v7, v6 calleeName="Object.keys"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = NewArray v5, v10 contents=undefined|null|number|Array<undefined|null|string>
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|number|Array<undefined|null|string>> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromAList"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string|[[L_1]]>):
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
// CHECK-NEXT: v9 = PropGet v4 key="length"
// CHECK-NEXT: v10 = PropGet v7 key="length"
// CHECK-NEXT: v11 = NewArray v9, v10 contents=number
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3() role=IterationCleanup subject=v1:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|"length" flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]], v1: undefined|null|"length"):
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = ToPropertyKey v1
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toFixed"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string=""
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
