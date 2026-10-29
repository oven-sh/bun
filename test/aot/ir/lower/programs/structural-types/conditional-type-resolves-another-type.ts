// RUN: lower
// OPTIONS: builtin-modules

// A conditional type resolves to another type at each call.
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

type Element<T> = T extends readonly (infer U)[] ? U : T;
type Result<T> = T extends (...parameters: never[]) => infer R ? R : T;
type Text<T> = T extends number ? string : T extends string ? number : T;

function elementOf<T>(value: T, pick: (value: T) => Element<T>): Element<T> {
  return pick(value);
}

function resultOf<T>(value: T, run: (value: T) => Result<T>): Result<T> {
  return run(value);
}

function turned<T>(value: T, turn: (value: T) => Text<T>): Text<T> {
  return turn(value);
}

function keep<T>(value: T, pick: (value: T) => Element<T>): Element<T>[] {
  const kept: Element<T>[] = [];
  for (let i = 0; i < 3; i++) kept.push(pick(value));
  return kept;
}

class Point {
  x = 2;
  twice(): number {
    return this.x * 2;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) total += elementOf([i, 1], list => list[0]) + elementOf(i, n => n) + resultOf(() => i, f => f()) + turned(i, n => String(n)).length + turned("ab", s => s.length);
console.log("2000 honest rounds: " + total);

attempt("elements", () => [elementOf([1, 2], l => l[1]) + 1, elementOf([0.5], l => l[0]) * 2, elementOf(["a"], l => l[0]).toUpperCase(), elementOf([new Point()], l => l[0]).twice(), elementOf([() => 3], l => l[0])(), elementOf([[1, 2]], l => l[0]).length]);
attempt("what is no list stays what it is", () => [elementOf(1, n => n) + 1, elementOf("ab", s => s).length, elementOf(new Point(), p => p).twice(), elementOf(null, n => n), elementOf(undefined, u => u)]);
attempt("a tuple gives a union", () => elementOf<[number, string]>([1, "a"], t => t[1]));
attempt("an element past the end of numbers", () => elementOf([1, 2], l => l[5]) + 1);
attempt("an element past the end of strings", () => elementOf(["a"], l => l[5]).length);
attempt("an element past the end of points", () => elementOf([new Point()], l => l[5]).twice());
attempt("an element past the end of functions", () => elementOf([() => 3], l => l[5])());
attempt("an element of holes", () => [typeof elementOf(new Array<number>(2), l => l[0]), elementOf(new Array<number>(2), l => l[0]) + 1]);
attempt("kept three times", () => [keep([1, 2], l => l[0]), keep([0.5], l => l[9]), keep("s", s => s), keep(["s"], l => l[0])]);
attempt("kept and summed", () => keep([1, 2], l => l[9]).reduce((a, b) => a + b, 0));
attempt("results", () => [resultOf(() => 1, f => f()) + 1, resultOf(() => "s", f => f()).length, resultOf(5, n => n) + 1, resultOf(() => new Point(), f => f()).twice(), resultOf(() => () => 2, f => f())()]);
attempt("turned", () => [turned(1, n => n.toFixed(1)).length, turned("abc", s => s.length) + 1, turned(true, b => b), turned(null, n => n)]);
attempt("turned at a union: each member by itself", () => {
  const either: number | string = process.argv.length > 0 ? 5 : "five";
  const other = turned<number | string>(either, v => (typeof v === "number" ? v + 1 : v + "!"));
  return [typeof other, other];
});

export {};

// GENERATED: elementOf attempt Point twice
// CHECK-LABEL: function {{*}}name="elementOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[f_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="pick"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v23 = Call v22, -, v8 calleeName="show"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Add v9, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull]}
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
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
