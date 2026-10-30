// RUN: lower
// OPTIONS: builtin-modules

// A generic invoke with a union key calls a method with the other methods argument.
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

class Printer {
  copies = 1;
  title = "doc";
  setCopies(count: number): string {
    this.copies = count * 2;
    return "copies " + count.toFixed(0);
  }
  setTitle(title: string): string {
    this.title = title.trim();
    return "title " + title.toUpperCase();
  }
  addBoth(count: number): number {
    return this.copies + count;
  }
}

interface Commands<A> {
  setCopies(argument: A): string;
  setTitle(argument: A): string;
}

interface Adds<A> {
  addBoth(argument: A): number;
}

function invoke<A, K extends keyof Commands<A>>(target: Commands<A>, key: K, argument: A): string {
  return target[key](argument);
}

function invokeAll<A>(target: Commands<A>, keys: (keyof Commands<A>)[], argument: A): string[] {
  return keys.map(key => target[key](argument));
}

function add<A>(target: Adds<A>, argument: A): number {
  return target.addBoth(argument);
}

const yes: boolean = process.argv.length > 0;

function state(p: Printer): string {
  return typeof p.copies + " " + show(p.copies) + ", " + typeof p.title + " " + show(p.title) + ", " + JSON.stringify(p);
}

let width = 0;
const warm = new Printer();
for (let i = 0; i < 2000; i++) width += warm.setCopies(i).length + warm.setTitle("t" + i).length + add(warm, 1);
console.log("2000 honest rounds: " + width);

const b = new Printer();
attempt("a string for the method that takes a number", () => invoke<number | string, "setCopies" | "setTitle">(b, yes ? "setCopies" : "setTitle", "three"));
console.log("afterwards: " + state(b));

const c = new Printer();
attempt("a number for the method that takes a string", () => invoke<number | string, "setCopies" | "setTitle">(c, yes ? "setTitle" : "setCopies", 3));
console.log("afterwards: " + state(c));

const h = new Printer();
attempt("each gets what it takes", () => [invoke<number | string, "setCopies">(h, "setCopies", 2), invoke<number | string, "setTitle">(h, "setTitle", " x "), state(h)]);

const d = new Printer();
attempt("a string is added", () => add<number | string>(d, "1"));
attempt("a string is added: typeof", () => typeof add<number | string>(d, "1"));
attempt("null is added", () => add<number | null>(d, null));
attempt("undefined is added", () => add<number | undefined>(d, undefined));
attempt("an object with valueOf is added", () => add<number | { valueOf(): number }>(d, { valueOf: () => 41 }));

const e = new Printer();
attempt("both methods get a number", () => invokeAll<number | string>(e, ["setCopies", "setTitle"], 4));
console.log("afterwards: " + state(e));
const f = new Printer();
attempt("both methods get a string", () => invokeAll<number | string>(f, ["setTitle", "setCopies"], " s "));
console.log("afterwards: " + state(f));
attempt("honest again", () => [warm.setCopies(1), warm.setTitle("z"), add(warm, 1), state(warm)]);

export {};

// GENERATED: invoke attempt Printer setCopies
// CHECK-LABEL: function {{*}}name="invoke"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_3]] site=[[w_4]]}, {type=undefined|null|[[L_5]] site=[[w_6]]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_3]], v2: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = ElemGet v0, v1
// CHECK-NEXT: v4 = Call v3, v0, v2 calleeName="target[key]"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v23 = Call v22, -, v8 calleeName="show"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Add v9, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull]}
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
// CHECK-LABEL: function {{*}}name="Printer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_17]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_17]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_18]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setCopies"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_17]] site=[[w_19]]} parameters=[{type=number site=[[w_20]]}] results=[{type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: [[L_17]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_23]]}
// CHECK-NEXT: PropSet v0, v4 key="copies"
// CHECK-NEXT: v6 = String string="copies "
// CHECK-NEXT: v7 = PropGet v1 key="toFixed"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Call v7, v1, v8 calleeKey="toFixed" calleeName="count.toFixed"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_24]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
