// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A project with strict property initialization off.
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

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Record2 {
  count: number;
  name: string;
  items: number[];
  owner: Dog;
  ready: boolean;
  run: () => number;

  next(): number {
    return this.count + 1;
  }
  bump(): number {
    return ++this.count;
  }
  title(): string {
    return this.name + "!";
  }
  width(): number {
    return this.name.length;
  }
  total(): number {
    let sum = 0;
    for (const n of this.items) sum += n;
    return sum;
  }
  add(n: number): number {
    return this.items.push(n);
  }
  legs(): number {
    return this.owner.legs;
  }
  state(): string {
    return this.ready ? "ready" : "waiting";
  }
  go(): number {
    return this.run() + 1;
  }
  fill(): this {
    this.count = 1;
    this.name = "ab";
    this.items = [1, 2];
    this.owner = new Dog();
    this.ready = true;
    this.run = () => 5;
    return this;
  }
}

attempt("honest", () => {
  const r = new Record2().fill();
  return [r.next(), r.bump(), r.title(), r.width(), r.total(), r.add(3), r.legs(), r.state(), r.go(), Object.keys(r)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const r = new Record2().fill();
  warm += r.next() + r.bump() + r.width() + r.total() + r.add(i) + r.legs() + r.go();
}
console.log("2000 honest rounds", warm);

attempt("keys of a new one", () => [Object.keys(new Record2()), "count" in new Record2(), JSON.stringify(new Record2())]);
attempt("count: next", () => new Record2().next());
attempt("count: bump", () => {
  const r = new Record2();
  return [r.bump(), r.count, r.bump()];
});
attempt("name: title", () => new Record2().title());
attempt("name: width", () => new Record2().width());
attempt("items: total", () => new Record2().total());
attempt("items: add", () => new Record2().add(1));
attempt("owner: legs", () => new Record2().legs());
attempt("ready: state", () => new Record2().state());
attempt("run: go", () => new Record2().go());
attempt("read from outside", () => {
  const r = new Record2();
  const n: number = r.count;
  const s: string = r.name;
  const b: boolean = r.ready;
  return [n, s, b, typeof n, n + 1, s + "!", !b, b === false];
});
attempt("half filled", () => {
  const r = new Record2();
  r.count = 1;
  r.items = [1];
  return [r.next(), r.total(), r.title(), Object.keys(r)];
});
attempt("filled in another order", () => {
  const r = new Record2();
  r.run = () => 1;
  r.ready = false;
  r.owner = new Dog();
  r.items = [];
  r.name = "z";
  r.count = 0;
  return [Object.keys(r), r.next(), r.title(), r.go()];
});
attempt("a subclass reads what the base never set", () => {
  class More extends Record2 {
    extra = this.count;
    twice(): number {
      return this.extra * 2;
    }
  }
  return [new More().extra, new More().twice()];
});
attempt("many in one list, some filled", () => {
  const list: Record2[] = [new Record2().fill(), new Record2(), new Record2().fill()];
  return list.map(r => r.next());
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "strictPropertyInitialization": false }, "files": [] }

// GENERATED: Dog total add fill More
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = PropGet v0 key="items"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v11 = Add v5, v9
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12)
// CHECK-NEXT: b5() role=IterationCleanup subject=v4:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_3]]} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="items"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="push" calleeName="this.items.push"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fill"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: PropSet v0, v1 key="count"
// CHECK-NEXT: v3 = String string="ab"
// CHECK-NEXT: PropSet v0, v3 key="name"
// CHECK-NEXT: v5 = Data data=[[d_4]]
// CHECK-NEXT: PropSet v0, v5 key="items"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Dog"
// CHECK-NEXT: v9 = Construct v8 calleeName="Dog"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: PropSet v0, v10 key="owner"
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: PropSet v0, v12 key="ready"
// CHECK-NEXT: v14 = NewClosure function=[[f_6]]
// CHECK-NEXT: PropSet v0, v14 key="run"
// CHECK-NEXT: v16 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="More"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
