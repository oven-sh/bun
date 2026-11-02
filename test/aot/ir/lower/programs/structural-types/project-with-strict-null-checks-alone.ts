// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A project with strict null checks off alone.
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

class Leaf {
  value: number = 1;
  next: Leaf = null;
  label: string = undefined;
  depth(): number {
    return this.next === null ? 1 : 1 + this.next.depth();
  }
}

function valueOf(l: Leaf): number {
  return l.value + 1;
}

function nextValue(l: Leaf): number {
  return l.next.value;
}

function labelSize(l: Leaf): number {
  return l.label.length;
}

function first(list: Leaf[]): Leaf {
  return list[0];
}

function lookUp(m: Map<string, number>, key: string): number {
  return m.get(key) + 1;
}

function matched(text: string): string {
  return /\d+/.exec(text)[0];
}

function orDefault(n: number): number {
  return n ?? 10;
}

function isNull(n: number): boolean {
  return n === null;
}

function chain(): Leaf {
  const a = new Leaf();
  a.next = new Leaf();
  a.label = "a";
  return a;
}

attempt("honest", () => [valueOf(chain()), nextValue(chain()), labelSize(chain()), chain().depth(), first([chain()]).value, lookUp(new Map([["a", 1]]), "a"), matched("a12"), orDefault(1), isNull(1)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += valueOf(chain()) + nextValue(chain()) + labelSize(chain()) + chain().depth() + orDefault(i);
console.log("2000 honest rounds", warm);

attempt("null for a leaf", () => valueOf(null));
attempt("undefined for a leaf", () => valueOf(undefined));
attempt("next is null", () => nextValue(new Leaf()));
attempt("label is undefined", () => labelSize(new Leaf()));
attempt("an empty list", () => first([]));
attempt("an empty list, then a field", () => first([]).value);
attempt("no such key", () => lookUp(new Map(), "a"));
attempt("no match", () => matched("abc"));
attempt("a default for null and undefined", () => [orDefault(null), orDefault(undefined), orDefault(0), orDefault(NaN)]);
attempt("compared with null", () => [isNull(null), isNull(undefined), isNull(0)]);
attempt("null in arithmetic", () => {
  const n: number = null;
  const u: number = undefined;
  return [n + 1, u + 1, n * 2, -n, n | 0, u | 0, n < 1, u < 1, n == u, n === u];
});
attempt("null in a list of numbers", () => {
  const list: number[] = [1, null, undefined, 2];
  let sum = 0;
  for (const n of list) sum += n;
  return [sum, list, list.map(n => n + 1), list.indexOf(null), list.includes(undefined)];
});
attempt("null in a template and in JSON", () => {
  const s: string = null;
  const o: { s: string; u: string; n: number } = { s, u: undefined, n: null };
  return [`${s}`, s + "", JSON.stringify(o), Object.keys(o)];
});
attempt("null narrowed away by nothing", () => {
  const pick = (flag: boolean): Leaf => (flag ? new Leaf() : null);
  return [pick(true).value, typeof pick(false)];
});
attempt("optional chaining where the type says it is never needed", () => {
  const l: Leaf = null;
  return [l?.value, l?.next?.value, new Leaf().next?.value];
});
attempt("honest again", () => [valueOf(chain()), nextValue(chain()), labelSize(chain()), chain().depth()]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "strictNullChecks": false }, "files": [] }

// GENERATED: labelSize lookUp matched Leaf depth pick
// CHECK-LABEL: function {{*}}name="labelSize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="label"
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lookUp"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_5]]}, {type=undefined|null|string site=[[w_6]]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="get"
// CHECK-NEXT: v3 = Call v2, v0, v1 calleeKey="get" calleeName="m.get"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="matched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]]}] results=[{type=undefined|null|string site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRegExp pattern="\\d+"
// CHECK-NEXT: v2 = PropGet v1 key="exec"
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeKey="exec" calleeName="exec"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = ElemGet v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_11]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Leaf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="depth"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_13]]} results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="next"
// CHECK-NEXT: v2 = TypeTest v1 testedType=null
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = PropGet v0 key="next"
// CHECK-NEXT: v8 = PropGet v7 key="depth"
// CHECK-NEXT: v9 = Call v8, v7 calleeKey="depth" calleeName="this.next.depth"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_15]]}
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_16]]}] results=[{type=undefined|null|[[L_1]] site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Leaf"
// CHECK-NEXT: v5 = Construct v4 calleeName="Leaf"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] site=[[w_20]]} illTypedCause=UnprovenCallee
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_1]] site=[[w_17]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
