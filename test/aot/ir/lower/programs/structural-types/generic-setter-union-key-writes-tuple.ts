// RUN: lower
// OPTIONS: builtin-modules

// A generic setter with a union key writes into a tuple.
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

type Entry = [number, string];
type Wide = [number, string, () => number, { id: number }];

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

function use(entry: Entry): string {
  return entry[0] + 1 + " " + entry[1].toUpperCase();
}

function destructured(entry: Entry): string {
  const [count, name] = entry;
  return count * 2 + " " + name.length;
}

const yes: boolean = process.argv.length > 0;

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " " + typeof entry[0] + " " + typeof entry[1] + " length " + entry.length);
  attempt("  used", () => use(entry));
  attempt("  destructured", () => destructured(entry));
  attempt("  [0].toFixed(1)", () => entry[0].toFixed(1));
  attempt("  [1].length", () => entry[1].length);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [0, "a"];
  set(entry, 0, i);
  set(entry, 1, "n" + i);
  total += use(entry).length + destructured(entry).length;
}
console.log("2000 honest rounds: " + total);

const a: Entry = [1, "a"];
set(a, yes ? 0 : 1, "text");
report("a string in the first place", a);
set(a, yes ? 1 : 0, 2);
report("a number in the second place", a);

const b: Entry = [1, "b"];
swap(b, 0, 1);
report("the places are exchanged", b);
swap(b, 0, 1);
report("and back", b);

const c: Entry = [1, "c"];
set(c, yes ? "0" : "1", "by a string key");
report("the key is a string of digits", c);

const d: Entry = [1, "d"];
set(d, yes ? "length" : 0, 1);
report("the length or the first place: the length", d);

const w: Wide = [1, "w", () => 2, { id: 3 }];
swap(w, 0, 2);
swap(w, 1, 3);
console.log("four places, exchanged in pairs: " + typeof w[0] + " " + typeof w[1] + " " + typeof w[2] + " " + typeof w[3]);
attempt("  [0] + 1", () => typeof (w[0] + 1));
attempt("  [1].length", () => w[1].length);
attempt("  [2]()", () => w[2]());
attempt("  [3].id", () => w[3].id);

export {};

// GENERATED: attempt destructured
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v23 = Call v22, -, v8 calleeName="show"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Add v9, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
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
// CHECK-LABEL: function {{*}}name="destructured"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|number|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v6 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Mul v5, v11
// CHECK-NEXT: v13 = String string=" "
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = PropGet v9 key="length"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v17 = Add v14, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b7() role=IterationCleanup subject=v1:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
