// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
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

function firstPlusOne(list: number[]): number {
  const first = list[0];
  return first === undefined ? -1 : first + 1;
}

function checkedInPlace(list: number[]): number {
  if (list[0] !== undefined) return list[0] + 1;
  return -1;
}

function checkedThenChanged(list: number[], change: () => void): number {
  if (list[0] !== undefined) {
    change();
    return list[0] + 1;
  }
  return -1;
}

function total(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

function totalByIndex(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i] ?? 1000;
  return sum;
}

function score(scores: Record<string, number>, name: string): number {
  const s = scores[name];
  return s === undefined ? -1 : s + 1;
}

function scoreInPlace(scores: Record<string, number>): number {
  return scores.a !== undefined ? scores.a + 1 : -1;
}

function letter(text: string, index: number): string {
  const c = text[index];
  return c === undefined ? "none" : c.toUpperCase();
}

function pair(t: [number, number]): number {
  return t[0] + t[1];
}

function unpacked(list: number[]): string {
  const [a, b] = list;
  return typeof a + ":" + typeof b;
}

function rest(list: number[]): number {
  const [, ...others] = list;
  return total(others);
}

attempt("honest", () => [firstPlusOne([1]), firstPlusOne([]), checkedInPlace([1]), checkedThenChanged([1], () => {}), total([1, 2]), totalByIndex([1, 2]), score({ a: 1 }, "a"), score({ a: 1 }, "b"), scoreInPlace({ a: 1 }), letter("ab", 1), letter("ab", 5), pair([1, 2]), unpacked([1]), rest([1, 2, 3])]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += firstPlusOne([i]) + checkedInPlace([i]) + total([i, 1]) + totalByIndex([i, 1]) + score({ a: i }, "a") + pair([i, 1]);
console.log("2000 honest rounds", warm);

attempt("holes: for-of hands out undefined as a number", () => total(new Array<number>(2)));
attempt("holes: by index", () => totalByIndex(new Array<number>(2)));
attempt("holes: in the middle", () => {
  const list = [1, 2, 3];
  delete list[1];
  return [total(list), totalByIndex(list), list.map(n => n + 1), list.reduce((a, b) => a + b, 0)];
});
attempt("holes: forEach, some and find see different things", () => {
  const list = new Array<number>(2);
  list[1] = 5;
  let visited = 0;
  list.forEach(() => visited++);
  const found: number | undefined = list.find(() => true);
  return [visited, found, list.findIndex(n => n === undefined), list.includes(5), list.indexOf(5)];
});
attempt("made longer", () => {
  const list = [1];
  list.length = 3;
  return [total(list), totalByIndex(list), unpacked(list)];
});
attempt("emptied between the test and the read", () => {
  const list = [1];
  return checkedThenChanged(list, () => {
    list.length = 0;
  });
});
attempt("an element that is a getter", () => {
  const list = [1];
  let reads = 0;
  Object.defineProperty(list, 0, { get: () => (reads++ === 0 ? 1 : undefined), configurable: true });
  return checkedInPlace(list);
});
attempt("a tuple that was popped", () => {
  const t: [number, number] = [1, 2];
  t.pop();
  return pair(t);
});
attempt("names that every object has", () => [score({}, "constructor"), score({}, "toString"), score({}, "__proto__"), score({}, "hasOwnProperty")]);
attempt("a name removed between the test and the read", () => {
  const scores: Record<string, number> = { a: 1 };
  const drop = () => {
    delete scores.a;
  };
  if (scores.a !== undefined) {
    drop();
    return scores.a + 1;
  }
  return -1;
});
attempt("odd indexes", () => [firstPlusOne([]), letter("ab", -1), letter("ab", 0.5), letter("ab", NaN), [1, 2][-1], [1, 2][1.5], [1, 2][Infinity]]);
attempt("spread and Math.max over holes", () => [Math.max(...new Array<number>(2)), [...new Array<number>(2)].length]);
attempt("an iterator result", () => {
  const it = [1][Symbol.iterator]();
  it.next();
  const r = it.next();
  return [r.done, r.value];
});
attempt("honest again", () => [firstPlusOne([1]), checkedInPlace([1]), total([1, 2]), totalByIndex([1, 2]), score({ a: 1 }, "a"), pair([1, 2])]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "noUncheckedIndexedAccess": true }, "files": [] }

// GENERATED: score rest get drop
// CHECK-LABEL: function {{*}}name="score"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number site=[[w_4]]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Integer integer=-1
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Convert v7 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=1 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b4(), notTaken b8()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v10 = Convert v5 declared={type=undefined|null|Array<number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b9():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v13 = Call v12, -, v10 calleeName="total"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=number site=[[w_9]]}}, {declared={type=number site=[[w_6]]}}]
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: AppendElement v5, v9
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b9() role=IterationCleanup subject=v1:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|1 site=[[w_11]]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="reads"
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_10]]
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = StrictEq v3, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|1 site=[[w_11]]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="drop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|object site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropDelete v0 key="a"
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
