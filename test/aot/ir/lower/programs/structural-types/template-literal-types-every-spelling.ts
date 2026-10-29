// RUN: lower
// OPTIONS: builtin-modules

// Template literal types hold every spelling of a number.
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

type Id = `id-${number}`;
type Size = `${number}px`;
type Switch = `is-${boolean}`;
type Big = `${bigint}n`;

function make(n: number): Id {
  return `id-${n}`;
}
function numberOf(id: Id): number {
  return Number(id.slice(3));
}
function pixels(size: Size): number {
  return parseFloat(size);
}
function isOn(value: Switch): boolean {
  return value === "is-true";
}
function isId(text: string): text is Id {
  return text.startsWith("id-") && text.length > 3 && !Number.isNaN(Number(text.slice(3)));
}

const table: Record<Id, number> = {};
function remember(id: Id, n: number): number {
  table[id] = n;
  return table[id];
}

const numbers: number[] = [0, -0, 1, 1.5, -1, NaN, Infinity, -Infinity, 1e21, 1e-7, 2 ** 31, 2 ** 53, 0xff, 1_000];
for (const n of numbers) {
  attempt(show(n), () => {
    const id = make(n);
    const size: Size = `${n}px`;
    return [id, id.length, numberOf(id), remember(id, n), size, pixels(size)];
  });
}
attempt("the table", () => [Object.keys(table), JSON.stringify(table)]);
attempt("a key that was never stored", () => {
  const missing: Id = "id-404";
  const held: number = table[missing];
  return [held, held + 1, typeof held, missing in table];
});
attempt("switches", () => {
  const flags: boolean[] = [true, false];
  const made: Switch[] = flags.map((flag): Switch => `is-${flag}`);
  return [made, made.map(isOn)];
});
attempt("bigints", () => {
  const values: bigint[] = [0n, -0n, -5n, 2n ** 64n];
  const made: Big[] = values.map((value): Big => `${value}n`);
  return made;
});
attempt("texts that a guard lets in", () =>
  ["id-1", "id- 1", "id-0x10", "id-1e3", "id-", "id--0", "id-Infinity", "id-1n", "id-١", "ID-1", "id-\n2"].map(text => (isId(text) ? [text, numberOf(text)] : "no: " + text)),
);
attempt("written out", () => {
  const ids: Id[] = ["id-1", "id-1.50", "id-1e3", "id-0x1F", "id--0", "id-+1", "id-.5", "id-5."];
  return ids.map(numberOf);
});

// GENERATED: make pixels isOn isId remember
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="id-"
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = Strcat v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pixels"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="parseFloat" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ParseFloat) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="parseFloat"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_4]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isOn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"is-false"|"is-true" site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_7]]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|"is-false"|"is-true"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="is-true"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="startsWith"
// CHECK-NEXT: v2 = String string="id-"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="startsWith" calleeName="text.startsWith"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Integer integer=3
// CHECK-NEXT: v10 = Greater v8, v9
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v15 = Builtin builtin=Number
// CHECK-NEXT: v16 = Builtin builtin=NumberIsNaN
// CHECK-NEXT: v17 = Builtin builtin=Number
// CHECK-NEXT: v18 = PropGet v0 key="slice"
// CHECK-NEXT: v19 = Integer integer=3
// CHECK-NEXT: v20 = Call v18, v0, v19 calleeKey="slice" calleeName="text.slice"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Call v17, -, v21 calleeName="Number"
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Call v16, v15, v23 calleeName="Number.isNaN"
// CHECK-NEXT: v25 = Convert v24 declared={type=boolean site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: v27 = LogicalNot v26
// CHECK-NEXT: Jump -> next b9(v27)
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: v30 = Convert v29 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="remember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_17]]}] results=[{type=number site=[[w_18]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="table"
// CHECK-NEXT: v4 = Convert v1 declared={type=number site=[[w_20]]}
// CHECK-NEXT: ElemSet v3, v0, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="table"
// CHECK-NEXT: v8 = ElemGet v7, v0
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|number site=[[w_21]]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
