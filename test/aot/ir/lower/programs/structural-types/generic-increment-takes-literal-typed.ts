// RUN: lower
// OPTIONS: builtin-modules

// A generic increment takes a literal typed field out of its union.
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

enum Level {
  Low,
  Mid,
  High,
}

interface Dial {
  step: 1 | 2 | 3;
  level: Level;
  bit: 0 | 1;
}

function bump<K extends string>(target: Record<K, number>, key: K): void {
  target[key] += 1;
}

function scale<K extends string>(target: Record<K, number>, key: K, by: number): void {
  target[key] *= by;
}

function nameOfStep(d: Dial): string {
  switch (d.step) {
    case 1:
      return "one";
    case 2:
      return "two";
    case 3:
      return "three";
  }
}

function nameOfLevel(d: Dial): string {
  if (d.level === Level.Low) return "low";
  if (d.level === Level.Mid) return "mid";
  if (d.level === Level.High) return "high";
  const never: never = d.level;
  return "never: " + show(never);
}

function flip(d: Dial): string {
  return d.bit === 0 ? "off" : "on";
}

const table: Record<1 | 2 | 3, string> = { 1: "first", 2: "second", 3: "third" };

function report(title: string, d: Dial): void {
  console.log(title + ": " + JSON.stringify(d));
  attempt("  step", () => nameOfStep(d));
  attempt("  typeof the name of the step", () => typeof nameOfStep(d));
  attempt("  level", () => nameOfLevel(d));
  attempt("  reverse mapping", () => Level[d.level]);
  attempt("  bit", () => flip(d));
  attempt("  table[step]", () => table[d.step]);
  attempt("  table[step].length", () => table[d.step].length);
  attempt("  step <= 3", () => d.step <= 3);
  attempt("  bit === 0 || bit === 1", () => d.bit === 0 || d.bit === 1);
}

const d: Dial = { step: 1, level: Level.Low, bit: 0 };
report("before", d);
bump(d, "step");
bump(d, "level");
bump(d, "bit");
report("one step up", d);
bump(d, "step");
bump(d, "level");
bump(d, "bit");
report("two steps up: the bit has left its union", d);
bump(d, "step");
bump(d, "level");
report("three steps up: all three have", d);
scale(d, "step", 0.5);
scale(d, "level", -1);
scale(d, "bit", 0);
report("fractions and negatives", d);
scale(d, "bit", -1);
scale(d, "step", NaN);
report("minus zero and not a number", d);
console.log("the bit is minus zero: " + Object.is(d.bit, -0));

export {};

// GENERATED: nameOfStep bump scale
// CHECK-LABEL: function {{*}}name="nameOfStep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="step"
// CHECK-NEXT: Switch v1 cases=[1, 2, 3] -> case b2(| 0), case b4(| 0), case b6(| 0), otherwise b8()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="step"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="one"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: v7 = NarrowByField v0, v6 key="step"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = String string="two"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = NarrowByField v0, v10 key="step"
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = String string="three"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[L_4]] site=[[w_5]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v1 testedType=object
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = RequireObjectCoercible v0 nullishAccess=Update
// CHECK-NEXT: v5 = ToPropertyKey v3
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: v8 = ElemGet v0, v7{{*}} callers
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: ElemSet v0, v7, v10
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="scale"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[L_6]] site=[[w_7]]}, {type=number site=[[w_8]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_6]], v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = TypeTest v1 testedType=object
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = RequireObjectCoercible v0 nullishAccess=Update
// CHECK-NEXT: v6 = ToPropertyKey v4
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = ElemGet v0, v8{{*}} callers
// CHECK-NEXT: v10 = Mul v9, v2
// CHECK-NEXT: ElemSet v0, v8, v10
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
