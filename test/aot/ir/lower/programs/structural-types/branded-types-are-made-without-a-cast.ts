// RUN: lower
// OPTIONS: builtin-modules

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type UserId = string & { readonly __brand: "UserId" };
type Meters = number & { readonly unit: "m" };
type Checked = { value: number } & { readonly checked: true };

function isUserId(text: string): text is UserId {
  return text.startsWith("u");
}
function isMeters(n: number): n is Meters {
  return n >= 0;
}
function assertChecked(box: { value: number }): asserts box is Checked {
  if (box.value < 0) throw new RangeError("negative");
}
function brand(text: string): UserId;
function brand(text: unknown): unknown {
  return text;
}
function measure(n: number): Meters;
function measure(n: unknown): unknown {
  return n;
}
function same<T>(value: T): T {
  return value;
}

function brandOf(id: UserId): "UserId" {
  return id.__brand;
}
function unitOf(length: Meters): "m" {
  return length.unit;
}
function checkedOf(box: Checked): true {
  return box.checked;
}
function greet(id: UserId): string {
  return "hello " + id + " " + id.length + " " + id.toUpperCase();
}
function twice(length: Meters): number {
  return length * 2;
}

attempt("a text by a guard", () => {
  const text: string = ["u", "7"].join("");
  if (!isUserId(text)) return "refused";
  return [text, typeof text, greet(text), brandOf(text), typeof brandOf(text), brandOf(text) === "UserId"];
});
attempt("a text by an overload", () => {
  const id = brand("u8");
  return [id, greet(id), brandOf(id), id.__brand === "UserId", "" + id.__brand];
});
attempt("the length of the brand", () => brandOf(brand("u9")).length);
attempt("a number by a guard", () => {
  const n: number = 2.5;
  if (!isMeters(n)) return "refused";
  return [n, twice(n), unitOf(n), typeof unitOf(n), unitOf(n) === "m"];
});
attempt("a number by an overload", () => {
  const length = measure(-0);
  return [length, twice(length), unitOf(length), 1 / length];
});
attempt("an object by an assertion", () => {
  const box = { value: 3 };
  assertChecked(box);
  return [box.value, checkedOf(box), box.checked ? "checked" : "unchecked", Object.keys(box), "checked" in box];
});
attempt("through a generic function", () => {
  const id = same(brand("u1"));
  const ids: UserId[] = [id, same<UserId>(brand("u2"))];
  return [ids, ids.map(brandOf), ids.map(greet)];
});
attempt("as keys", () => {
  const table: Record<UserId, number> = {};
  table[brand("u1")] = 1;
  const plain: Record<string, number> = table;
  return [plain["u1"], table[brand("u" + 1)], table[brand("u2")], Object.keys(table)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += greet(brand("u" + (i % 10))).length + twice(measure(i));
console.log("2000 rounds", warm);

// GENERATED: isUserId isMeters assertChecked attempt
// CHECK-LABEL: function {{*}}name="isUserId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="startsWith"
// CHECK-NEXT: v2 = String string="u"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="startsWith" calleeName="text.startsWith"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=boolean site=[[w_3]]}}, {declared={type=boolean site=[[w_2]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isMeters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_4]]}] results=[{type=boolean site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = GreaterEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_5]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="assertChecked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Less v1, v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="RangeError" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="negative"
// CHECK-NEXT: v8 = Construct v6, -, v7 calleeName="RangeError"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Call v6, v4, v0, v7, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="threw"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="Error" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v23 = InstanceOf v13, v22 writtenExpression="error instanceof Error"
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="constructor"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = TypeOf v13
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v18, v16, v0, v19, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
