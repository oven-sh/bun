// RUN: lower
// OPTIONS: builtin-modules

// A partial view deletes and blanks required fields.
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

class Point {
  x = 1;
  y = 2.5;
  name = "p";
  sum(): number {
    return this.x + this.y;
  }
  shout(): string {
    return this.name.toUpperCase();
  }
}

function remove<T extends object>(target: T, key: keyof T): void {
  const view: Partial<T> = target;
  delete view[key];
}

function blank<T extends object>(target: T, key: keyof T): void {
  const view: Partial<T> = target;
  view[key] = undefined;
}

function report(title: string, p: Point): void {
  console.log(title + ": " + typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + typeof p.name + " " + show(p.name) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p) + ", x in it: " + ("x" in p) + ", own: " + Object.hasOwn(p, "x"));
  attempt("  sum", () => p.sum());
  attempt("  shout", () => p.shout());
  attempt("  x + 1", () => p.x + 1);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = new Point();
  p.x = i;
  total += p.sum() + p.shout().length;
}
console.log("2000 honest rounds: " + total);

const a = new Point();
blank(a, "x");
report("x is blanked", a);
a.x = 5;
report("and stored again", a);

const b = new Point();
remove(b, "x");
report("x is deleted", b);
b.x = 5;
report("and stored again: it is the last key now", b);

const c = new Point();
remove(c, "y");
remove(c, "name");
report("y and the name are deleted", c);
c.name = "again";
c.y = 0.5;
report("and stored again in the other order", c);

const d = new Point();
const view: Partial<Point> = d;
delete view.x;
view.name = undefined;
report("without a generic function", d);

const e = new Point();
remove(e, "sum");
report("a method is deleted from the instance: nothing happens", e);
blank(e, "sum");
report("a method is blanked on the instance", e);

const points = [new Point(), new Point(), new Point()];
remove(points[1], "x");
attempt("a sum over three points, one without x", () => points.reduce((sum, p) => sum + p.x, 0));
attempt("their keys", () => points.map(p => Object.keys(p).join("")));
report("a fresh one", new Point());

export {};

// GENERATED: attempt remove blank Point shout
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
// CHECK-LABEL: function {{*}}name="remove"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_10]]}, {type=undefined|null|number|string|symbol site=[[w_11]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]], v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemDelete v0, v1
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="blank"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_12]] site=[[w_13]]}, {type=undefined|null|number|string|symbol site=[[w_14]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_12]], v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_16]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shout"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_15]] site=[[w_17]]} results=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: [[L_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = PropGet v1 key="toUpperCase"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="toUpperCase" calleeName="this.name.toUpperCase"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
