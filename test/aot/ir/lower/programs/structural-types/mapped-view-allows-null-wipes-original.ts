// RUN: lower
// OPTIONS: builtin-modules

// A mapped view that allows null wipes the fields of the original.
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

type Nullable<T> = { [K in keyof T]: T[K] | null };

function wipe<T extends object>(target: T): void {
  const view: Nullable<T> = target;
  for (const key in view) view[key] = null;
}

function wipeOne<T extends object>(target: T, key: keyof T): void {
  const view: Nullable<T> = target;
  view[key] = null;
}

class Sensor {
  reading = 20;
  drift = 0.125;
  place = "roof";
  history: number[] = [1, 2];
  alarm: () => string = () => "ring";
  warmer(): number {
    return this.reading + 1;
  }
  corrected(): number {
    return this.reading - this.drift;
  }
  where(): string {
    return this.place.toUpperCase();
  }
  count(): number {
    return this.history.length;
  }
}

function report(title: string, s: Sensor): void {
  console.log(title + ": " + typeof s.reading + " " + typeof s.drift + " " + typeof s.place + " " + typeof s.history + " " + typeof s.alarm + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  warmer", () => s.warmer());
  attempt("  corrected", () => s.corrected());
  attempt("  where", () => s.where());
  attempt("  count", () => s.count());
  attempt("  alarm", () => s.alarm());
  attempt("  reading === null", () => [s.reading === null, s.reading === 0, s.reading == undefined]);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const s = new Sensor();
  s.reading = i;
  total += s.warmer() + s.corrected() + s.where().length + s.count() + s.alarm().length;
}
console.log("2000 honest rounds: " + total);

const one = new Sensor();
report("before", one);
wipeOne(one, "reading");
report("the reading is null", one);
wipeOne(one, "drift");
report("the drift too", one);
wipeOne(one, "place");
report("the place too", one);
wipeOne(one, "history");
wipeOne(one, "alarm");
report("all five", one);

const all = new Sensor();
wipe(all);
report("wiped in one loop", all);

const method = new Sensor();
wipeOne(method, "warmer");
report("a method is wiped: an own null over it", method);
report("a fresh one", new Sensor());

const literal = { a: 1, b: "two", c: [3] };
wipe(literal);
attempt("a literal", () => [literal, typeof literal.a, literal.a + 1]);
attempt("a literal: a method of its string", () => literal.b.length);
const list = [1, 2, 3];
wipe(list);
attempt("a list of numbers", () => [list, list[0] + 1, list.length]);

export {};

// GENERATED: wipe wipeOne Sensor warmer corrected where count alarm
// CHECK-LABEL: function {{*}}name="wipe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ForInOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v3 = ForInStep v1, v0
// CHECK-NEXT: v4 = ResultAt v3
// CHECK-NEXT: v5 = ResultAt v3 index=1
// CHECK-NEXT: Branch v4 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|string site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: ElemSet v0, v7, v8
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="wipeOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]]}, {type=undefined|null|number|string|symbol site=[[w_6]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Null
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Sensor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="warmer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_9]]} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="reading"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="corrected"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_11]]} results=[{type=number site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="reading"
// CHECK-NEXT: v2 = PropGet v0 key="drift"
// CHECK-NEXT: v3 = Sub v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="where"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_13]]} results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="place"
// CHECK-NEXT: v2 = PropGet v1 key="toUpperCase"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="toUpperCase" calleeName="this.place.toUpperCase"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_16]]} results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="history"
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="alarm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="ring"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
