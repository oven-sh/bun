// RUN: lower
// OPTIONS: builtin-modules

// Double casts give primitives another primitive type.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

function half(n: number): number {
  return n / 2;
}

function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

function total(list: number[]): number {
  let sum = 0;
  for (const value of list) sum += value;
  return sum;
}

function yes(b: boolean): number {
  return b ? 1 : 2;
}

function exactlyTrue(b: boolean): boolean {
  return b === true;
}

function honest(label: string): void {
  console.log(label, half(3), code("a"), total([1, 2]), yes(true), yes(false), exactlyTrue(true));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + code("a") + total([i]) + yes(i % 2 === 0);
console.log("2000 honest rounds", warm);

attempt("a string as a number", () => half("8" as unknown as number));
attempt("a string as a number, added", () => ("8" as unknown as number) + 1);
attempt("a string as a number, in a local", () => {
  const n: number = "8" as unknown as number;
  return n + n;
});
attempt("a string as a number, compared", () => ("10" as unknown as number) < ("9" as unknown as number));
attempt("a string as a number, incremented", () => {
  let n = "8" as unknown as number;
  n++;
  return n;
});
attempt("a string as a number, plus-assigned", () => {
  let n = "8" as unknown as number;
  n += 1;
  return n;
});
attempt("a string as a number, typeof", () => typeof ("8" as unknown as number));
attempt("a string as a number, toFixed", () => ("8" as unknown as number).toFixed(1));
attempt("a string as a number, as an index", () => [1, 2, 3]["1" as unknown as number]);
attempt("a string as a number, strict equality", () => ("8" as unknown as number) === 8);
attempt("a string as a number, in a template", () => `${"8" as unknown as number}`);
attempt("a string as a number, in an array of numbers", () => total([1, "8" as unknown as number, 2]));
attempt("a string as a number, Math.max", () => Math.max("8" as unknown as number, 2));
attempt("a string as a number, bit or", () => ("8.7" as unknown as number) | 0);
attempt("null as a number", () => half(null as unknown as number));
attempt("undefined as a number", () => half(undefined as unknown as number));
attempt("a bigint as a number", () => half(8n as unknown as number));
attempt("a bigint as a number, added to itself", () => (8n as unknown as number) + (8n as unknown as number));
attempt("an object as a number", () => half({ valueOf: () => (log.push("valueOf"), 8) } as unknown as number));
attempt("true as a number", () => half(true as unknown as number));
attempt("a symbol as a number", () => half(Symbol() as unknown as number));

attempt("a number as a string", () => code(65 as unknown as string));
attempt("a number as a string, added", () => (65 as unknown as string) + (1 as unknown as string));
attempt("a number as a string, length", () => (65 as unknown as string).length);
attempt("a number as a string, template", () => `${-0 as unknown as string}`);
attempt("a number as a string, equality", () => (65 as unknown as string) === "65");
attempt("a number as a string, switch", () => {
  switch (65 as unknown as string) {
    case "65":
      return "text";
    default:
      return "other";
  }
});
attempt("a number as a string, as a key", () => ({ "65": "found" })[65 as unknown as "65"]);
attempt("an array as a string", () => code(["a", "b"] as unknown as string));
attempt("null as a string", () => code(null as unknown as string));
attempt("null as a string, added", () => (null as unknown as string) + "!");
attempt("a String object as a string", () => code(new String("abc") as unknown as string));
attempt("a String object as a string, typeof", () => typeof (new String("abc") as unknown as string));
attempt("a String object as a string, truthiness", () => (new String("") as unknown as string ? "truthy" : "falsy"));

attempt("a string as an array", () => total("12" as unknown as number[]));
attempt("a set as an array", () => total(new Set([1, 2]) as unknown as number[]));
attempt("an array of strings as an array of numbers", () => total(["1", "2"] as unknown as number[]));
attempt("a typed array as an array", () => total(new Uint8Array([1, 2]) as unknown as number[]));
attempt("an array-like as an array", () => total({ length: 1, 0: 1 } as unknown as number[]));
attempt("a tuple cast to a longer tuple", () => {
  const t = [1] as unknown as [number, number];
  return t[0] + t[1];
});

for (const [name, value] of [["0", 0], ["1", 1], ["''", ""], ["'false'", "false"], ["null", null], ["undefined", undefined], ["NaN", NaN], ["{}", {}], ["[]", []], ["0n", 0n], ["-0", -0]] as [string, unknown][]) {
  attempt(name + " as a boolean: branch", () => yes(value as boolean));
  attempt(name + " as a boolean: === true", () => exactlyTrue(value as boolean));
  attempt(name + " as a boolean: not", () => !(value as boolean));
  attempt(name + " as a boolean: and", () => (value as boolean) && "right");
  attempt(name + " as a boolean: or", () => (value as boolean) || "right");
}

honest("honest after");

// GENERATED: half code total exactlyTrue valueOf
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="code"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="charCodeAt"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="charCodeAt" calleeName="s.charCodeAt"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v0 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number site=[[w_10]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="exactlyTrue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_11]]}] results=[{type=boolean site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="valueOf"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_16]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Integer integer=8
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
