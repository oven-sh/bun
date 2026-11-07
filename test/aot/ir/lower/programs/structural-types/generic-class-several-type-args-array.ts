// RUN: lower
// OPTIONS: builtin-modules

// One generic class at several type arguments in one array.
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

class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  set(value: T): void {
    this.value = value;
  }
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

interface Point {
  x: number;
  y: number;
}

function half(b: Box<number>): number {
  return b.get() / 2;
}

function size(b: Box<string>): number {
  return b.value.length;
}

function sum(b: Box<Point>): number {
  return b.value.x + b.get().y;
}

function total(b: Box<number[]>): number {
  let result = 0;
  for (const n of b.get()) result += n;
  return result;
}

function run(b: Box<() => number>): number {
  return b.get()() + b.value();
}

function kind(b: Box<unknown>): string {
  return typeof b.get();
}

attempt("each alone", () => [half(new Box(3)), half(new Box(1.5)), size(new Box("ab")), sum(new Box({ x: 1, y: 2 })), total(new Box([1, 2])), run(new Box(() => 4))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(new Box(i)) + size(new Box("ab")) + sum(new Box({ x: i, y: 1 })) + total(new Box([i])) + run(new Box(() => i));
console.log("2000 honest rounds", warm);

attempt("all in one array", () => {
  const boxes: Box<unknown>[] = [new Box(1), new Box(1.5), new Box("s"), new Box({ x: 1, y: 2 }), new Box([1]), new Box(() => 1), new Box(null), new Box(undefined), new Box(1n), new Box(true), new Box(-0), new Box(new Box(1))];
  return boxes.map(kind);
});
attempt("values read from one array", () => {
  const boxes: Box<number | string>[] = [new Box<number | string>(1), new Box<number | string>("s"), new Box<number | string>(2.5)];
  return boxes.map(b => {
    const v = b.get();
    return typeof v === "number" ? v + 1 : v + "!";
  });
});
attempt("a box of numbers seen as a box of numbers or strings", () => {
  const numbers = new Box(1);
  const wide: Box<number | string> = numbers;
  wide.set("text");
  return [half(numbers), numbers.value, typeof numbers.get()];
});
attempt("the same through the field", () => {
  const numbers = new Box(1);
  const wide: Box<number | string> = numbers;
  wide.value = "text";
  return numbers.value + 1;
});
attempt("a box of points seen as a box of narrower things", () => {
  const points = new Box<Point>({ x: 1, y: 2 });
  const wide: Box<{ x: number }> = points;
  wide.set({ x: 5 });
  return sum(points);
});
attempt("a box of lists gets a string through a wider view", () => {
  const lists = new Box<number[]>([1, 2]);
  const wide: Box<number[] | string> = lists;
  wide.set("12");
  return total(lists);
});
attempt("a box of functions gets a class through a wider view", () => {
  const functions = new Box<() => number>(() => 1);
  const wide: Box<Function> = functions;
  wide.set(class {});
  return run(functions);
});
attempt("a box emptied through a wider view", () => {
  const texts = new Box("ab");
  const wide: Box<string | null> = texts;
  wide.set(null);
  return size(texts);
});
attempt("mapped from kind to kind", () => new Box(1).map(n => "n" + n).map(s => s.length).map(n => [n, n]).map(l => l.length).get());
attempt("one site sees every kind in turn", () => {
  const read = <T>(b: Box<T>): T => b.get();
  const results: unknown[] = [];
  for (let i = 0; i < 2000; i++) {
    const n = read(new Box(i));
    const s = read(new Box("s" + i));
    const p = read(new Box({ x: i, y: 1 }));
    if (i === 1999) results.push(n + 1, s.length, p.x + p.y);
  }
  return results;
});
attempt("a literal stands for a box", () => {
  const fake: Box<number> = { value: 8, get: () => 80, set: () => {}, map: <U>(f: (value: number) => U) => new Box(f(800)) };
  return [half(fake), fake.map(n => n + 1).get(), fake instanceof Box];
});
attempt("subclasses at fixed arguments", () => {
  class Count extends Box<number> {
    get(): number {
      return super.get() + 100;
    }
  }
  class Name extends Box<string> {}
  const boxes: Box<number | string>[] = [new Count(1), new Name("n")];
  return [half(new Count(2)), size(new Name("abc")), boxes.map(b => b.get())];
});

// GENERATED: total Box get Count
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v3 = PropGet v0 key="get"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="get" calleeName="b.get"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v6
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Convert v7 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v13 = Convert v11 declared={type=number site=[[w_6]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v14 = Add v7, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b7() role=IterationCleanup subject=v6:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_8]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_10]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_7]] site=[[w_11]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v6 key="value"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_12]]} results=[{type=undefined|null|[[L_7]] site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_7]] site=[[w_13]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_15]]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=80
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_18]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_18]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_18]] site=[[w_19]]} results=[{type=number site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: function, v1: [[L_18]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v1 key="get"
// CHECK-NEXT: v4 = Call v3, v1 calleeName="super.get"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_22]]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Integer integer=100
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_20]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
