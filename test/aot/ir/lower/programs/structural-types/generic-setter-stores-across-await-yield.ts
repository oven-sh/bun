// RUN: lower
// OPTIONS: builtin-modules

// A generic setter stores across an await and a yield.
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

interface Point {
  x: number;
  name: string;
}

async function setLater<T, K extends keyof T>(target: T, key: K, value: Promise<T[K]>): Promise<void> {
  target[key] = await value;
}

function* setEach<T, K extends keyof T>(target: T, key: K): Generator<T[K], number, T[K]> {
  let count = 0;
  for (;;) {
    const value = yield target[key];
    target[key] = value;
    count++;
    if (count === 3) return count;
  }
}

const yes: boolean = process.argv.length > 0;

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p);
}

async function sumAround(p: Point, between: Promise<void>): Promise<string> {
  const before = p.x + 1;
  await between;
  const after = p.x + 1;
  return show(before) + " then " + show(after);
}

const a: Point = { x: 1, name: "a" };
await setLater(a, "x", Promise.resolve(2));
console.log("honest: " + describe(a) + " " + (a.x + 1));
await setLater(a, yes ? "x" : "name", Promise.resolve("late"));
console.log("a string arrives later: " + describe(a));
attempt("  x + 1", () => a.x + 1);
attempt("  x.toFixed(0)", () => a.x.toFixed(0));

const b: Point = { x: 1, name: "b" };
console.log("read, awaited, read again: " + (await sumAround(b, setLater(b, yes ? "x" : "name", Promise.resolve("between")))));
console.log("afterwards: " + describe(b));

const c: Point = { x: 1, name: "c" };
const steps = setEach(c, yes ? "x" : "name");
console.log("started: " + show(steps.next().value));
console.log("an honest value: " + show(steps.next(5).value) + " " + describe(c) + " " + (c.x + 1));
console.log("a string: " + show(steps.next("sent in").value) + " " + describe(c));
attempt("  x + 1", () => c.x + 1);
attempt("  x * 2", () => c.x * 2);
const last = steps.next(7);
console.log("the last one: " + show(last.value) + " " + last.done + " " + describe(c) + " " + (c.x + 1));

const d: Point = { x: 1, name: "d" };
await Promise.all([setLater(d, yes ? "x" : "name", Promise.resolve("first")), setLater(d, yes ? "name" : "x", Promise.resolve(9)), setLater(d, "x", Promise.resolve(3))]);
console.log("three at once: " + describe(d));
attempt("  x + 1", () => d.x + 1);
attempt("  name.length", () => d.name.length);
attempt("  name.toUpperCase()", () => d.name.toUpperCase());

export {};

// GENERATED: setLater setEach describe
// CHECK-LABEL: function {{*}}name="setLater"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|[[L_3]] site=[[w_4]]}, {type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]], v2: undefined|null|[[L_3]], v3: undefined|null|Promise):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Await v3, v1, v2, v3
// CHECK-NEXT: ElemSet v1, v2, v4
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setEach"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]]}, {type=undefined|null|[[L_7]] site=[[w_8]]}] results=[{type=undefined|null|Generator flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|[[L_5]], v3: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2, v3
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v6)
// CHECK-NEXT: b2(v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = ElemGet v2, v3
// CHECK-NEXT: v10 = Yield v9, v2, v3
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b6():
// CHECK-NEXT: ElemSet v2, v3, v11
// CHECK-NEXT: v14 = Increment v7
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v16 = Integer integer=3
// CHECK-NEXT: v17 = StrictEq v15, v16
// CHECK-NEXT: Branch v17 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v19 = Convert v18 declared={type=3} illTypedCause=Assertion
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b2(v20)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v6 = PropGet v0 key="x"
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="show"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Add v4, v8
// CHECK-NEXT: v10 = String string=", "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = PropGet v0 key="name"
// CHECK-NEXT: v13 = TypeOf v12
// CHECK-NEXT: v14 = Add v11, v13
// CHECK-NEXT: v15 = String string=" "
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v18 = PropGet v0 key="name"
// CHECK-NEXT: v19 = Call v17, -, v18 calleeName="show"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = Add v16, v20
// CHECK-NEXT: v22 = String string=", "
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = Builtin builtin=JSON
// CHECK-NEXT: v25 = PropGet v24 key="stringify"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Add v23, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
