// RUN: lower
// OPTIONS: builtin-modules

// Captured variables hold lookalikes from any.
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

interface Point {
  x: number;
  y: number;
}

function counter(start: number): { next: () => number; set: (value: number) => void } {
  let count: number = start;
  return {
    next: () => ++count,
    set: value => {
      count = value;
    },
  };
}

function keeper(first: string): { size: () => number; shout: () => string; set: (value: string) => void } {
  let text: string = first;
  return {
    size: () => text.length,
    shout: () => text.toUpperCase() + "!",
    set: value => {
      text = value;
    },
  };
}

function collector(first: number[]): { total: () => number; add: (n: number) => number; set: (value: number[]) => void } {
  let list: number[] = first;
  return {
    total: () => {
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += list[i];
      return sum;
    },
    add: n => list.push(n),
    set: value => {
      list = value;
    },
  };
}

function tracker(first: Point): { sum: () => number; move: () => void; set: (value: Point) => void } {
  let p: Point = first;
  return {
    sum: () => p.x + p.y,
    move: () => {
      p.x += 1;
    },
    set: value => {
      p = value;
    },
  };
}

function runner(first: (n: number) => number): { run: () => number; set: (value: (n: number) => number) => void } {
  let f = first;
  return { run: () => f(1) + 1, set: value => void (f = value) };
}

let moduleCount: number = 0;
let moduleName: string = "module";
function bumpModule(): number {
  return ++moduleCount + moduleName.length;
}

function honest(label: string): void {
  const c = counter(1);
  const k = keeper("ab");
  const l = collector([1, 2]);
  const t = tracker({ x: 1, y: 2 });
  const r = runner(n => n);
  t.move();
  moduleCount = 0;
  moduleName = "module";
  console.log(label, c.next(), c.next(), k.size(), k.shout(), l.total(), l.add(3), l.total(), t.sum(), r.run(), bumpModule());
}

honest("honest before");
const busyCounter = counter(0);
const busyList = collector([]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += busyCounter.next() + busyList.add(i) + bumpModule();
console.log("2000 honest rounds", warm, busyList.total());

for (const text of ["5", "'5'", "5n", "-0", "2147483647", "null", "undefined", "{ valueOf() { note('valueOf'); return 5; } }", "NaN", "1.5"]) {
  const started = counter(hidden(text));
  attempt("counter started with " + text, () => [started.next(), started.next()]);
  const changed = counter(1);
  changed.next();
  changed.set(hidden(text));
  attempt("counter set to " + text, () => [changed.next(), changed.next()]);
  attempt("module variable set to " + text, () => {
    moduleCount = hidden(text);
    return [bumpModule(), bumpModule()];
  });
}
moduleCount = 0;

for (const text of ["'abc'", "5", "null", "undefined", "['a']", "new String('abc')", "{ length: 1, toUpperCase() { return 5; } }"]) {
  const changed = keeper("ab");
  changed.size();
  changed.set(hidden(text));
  attempt("keeper set to " + text + ": size", () => changed.size());
  attempt("keeper set to " + text + ": shout", () => changed.shout());
  attempt("module name set to " + text, () => {
    moduleName = hidden(text);
    return bumpModule();
  });
}
moduleName = "module";

for (const text of ["[1, 2]", "['1', '2']", "[1, , 2]", "'12'", "{ length: 1, 0: 4 }", "new Uint8Array([1])", "null", "Object.freeze([1])", "new (class extends Array { push() { return 42; } })(1, 2)"]) {
  const changed = collector([1]);
  changed.total();
  changed.set(hidden(text));
  attempt("collector set to " + text + ": total", () => changed.total());
  attempt("collector set to " + text + ": add", () => changed.add(3));
  attempt("collector set to " + text + ": total again", () => changed.total());
}

for (const text of ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{}", "null", "5", "Object.freeze({ x: 1, y: 2 })", "{ get x() { note('get-x'); return 1; }, set x(v) { note('set-x'); }, y: 2 }"]) {
  const changed = tracker({ x: 0, y: 0 });
  changed.sum();
  changed.set(hidden(text));
  attempt("tracker set to " + text + ": sum", () => changed.sum());
  attempt("tracker set to " + text + ": move", () => changed.move());
  attempt("tracker set to " + text + ": sum again", () => changed.sum());
}

for (const text of ["n => n * 2", "n => 'text'", "null", "class {}", "new Proxy(n => n, { apply() { return 9; } })"]) {
  const changed = runner(n => n);
  changed.run();
  changed.set(hidden(text));
  attempt("runner set to " + text, () => changed.run());
}

honest("honest after");

// GENERATED: counter hidden total add move
// CHECK-LABEL: function {{*}}name="counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_4]]
// CHECK-NEXT: v2 = Convert v0 declared={type=number site=[[w_5]]}
// CHECK-NEXT: PutEnvironmentField v1, v2 layout=[[L_4]]
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewClosure v1 function=[[f_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = NewObject -, v5, v7 layout=[[L_2]] fields=[0, 1]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="eval" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="("
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = String string=")"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Call v3, -, v7
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: env [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_15]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="list"
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_17]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = Less v8, v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="list"
// CHECK-NEXT: v17 = Convert v14 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v18 = ElemGet v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_18]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v20 = Add v5, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Increment v17
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Jump -> next b2(v21, v23)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Convert v5 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=env [[L_12]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=number site=[[w_19]]}] results=[{type=number site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="list"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number site=[[w_22]]}}, {declared={type=number site=[[w_20]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="move"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_23]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0(v0: env [[L_23]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_23]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="p"
// CHECK-NEXT: v3 = PropGet v2 key="x"
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_25]]}
// CHECK-NEXT: PropSet v2, v6 key="x"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
