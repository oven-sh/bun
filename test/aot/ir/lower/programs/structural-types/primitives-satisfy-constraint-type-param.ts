// RUN: lower
// OPTIONS: builtin-modules

// Primitives satisfy the constraint of a type parameter.
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

function lengthOf<T extends { length: number }>(x: T): number {
  return x.length;
}

function longer<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function textOf<T extends { toString(): string }>(x: T): string {
  return x.toString();
}

function valueOf<T extends { valueOf(): number }>(x: T): number {
  return x.valueOf() + 1;
}

function anything<T extends {}>(x: T): string {
  return typeof x;
}

function fixed<T extends { toFixed(digits: number): string }>(x: T): string {
  return x.toFixed(1);
}

function at<T extends { at(index: number): unknown }>(x: T): unknown {
  return x.at(-1);
}

function sliced<T extends { slice(start: number): T }>(x: T): T {
  return x.slice(1);
}

function kept<T extends { length: number }>(x: T): { held: T; size: number } {
  return { held: x, size: x.length };
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += lengthOf([i]) + longer([i], [i, 1]).length + textOf({ toString: () => "t" }).length + valueOf({ valueOf: () => i }) + fixed({ toFixed: () => "f" }).length;
console.log("2000 honest rounds with objects", warm);

attempt("length of a string", () => lengthOf("abc"));
attempt("length of an empty string", () => lengthOf(""));
attempt("length of an array", () => lengthOf([1, 2]));
attempt("length of a function", () => lengthOf((a: number, b: number) => a + b));
attempt("length of a class", () => lengthOf(class { constructor(a: number) {} }));
attempt("length of a typed array", () => lengthOf(new Uint8Array(3)));
attempt("length of a String object", () => lengthOf(new String("abcd")));
attempt("length of a literal", () => lengthOf({ length: -1 }));
attempt("length of a getter", () => lengthOf({ get length() { log.push("get-length"); return 7; } }));
attempt("length of arguments", () => (function (a: number, b: number) { return lengthOf(arguments); })(1, 2));
attempt("longer of two strings", () => longer("ab", "abc"));
attempt("longer of two arrays", () => longer([1, 2, 3], [4]));
attempt("longer of a string and an array", () => longer<string | number[]>("ab", [1, 2, 3]));
attempt("text of a number", () => textOf(5));
attempt("text of negative zero", () => textOf(-0));
attempt("text of a string", () => textOf("s"));
attempt("text of a boolean", () => textOf(true));
attempt("text of a bigint", () => textOf(5n));
attempt("text of a symbol", () => textOf(Symbol("s")));
attempt("text of an array", () => textOf([1, [2, 3]]));
attempt("text of a function", () => textOf(Math.max).length > 0);
attempt("text of a literal", () => textOf({}));
attempt("value of a number", () => valueOf(5));
attempt("value of a Number object", () => valueOf(new Number(5)));
attempt("value of a date", () => valueOf(new Date(5)));
attempt("anything", () => [anything(1), anything("s"), anything(true), anything(1n), anything(Symbol()), anything([]), anything(() => {}), anything({})]);
attempt("fixed of a number", () => fixed(1.25));
attempt("fixed of a Number object", () => fixed(new Number(2)));
attempt("at of a string and an array", () => [at("abc"), at([1, 2]), at(new Uint8Array([7, 8]))]);
attempt("sliced", () => [sliced<string>("abc"), sliced([1, 2, 3])]);
attempt("kept in a member", () => {
  const a = kept("abc");
  const b = kept([1, 2]);
  const c = kept((x: number) => x);
  return [a.held + "!", a.size, b.held.length, b.size, c.held(5), c.size];
});
attempt("kept in one array", () => {
  const all: { length: number }[] = ["abc", [1, 2], (x: number) => x, new Uint8Array(4), { length: 5 }, new String("abcdef")];
  return all.map(lengthOf);
});
attempt("one site, many kinds, many times", () => {
  const all: { length: number }[] = ["abc", [1, 2], (x: number) => x, new Uint8Array(4), { length: 5 }];
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += lengthOf(all[i % all.length]);
  return sum;
});

// GENERATED: longer valueOf anything fixed kept length
// CHECK-LABEL: function {{*}}name="longer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|[[L_1]] site=[[w_3]]}] results=[{type=undefined|null|[[L_1]] site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = PropGet v1 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = GreaterEq v3, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b4(v0)
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4(v1)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] site=[[w_4]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_8]]}] results=[{type=number site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="valueOf"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="valueOf" calleeName="x.valueOf"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_10]]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anything"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_11]] site=[[w_12]]}] results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_14]] site=[[w_15]]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toFixed"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="toFixed" calleeName="x.toFixed"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_18]] site=[[w_19]]}] results=[{type=undefined|null|[[L_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_18]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_18]]}
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_20]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=number site=[[w_23]]}] thisType={type=anything} results=[{type=number site=[[w_24]]}] functionTypes={{*}}[[f_25]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_24]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_26]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_27]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="get-length"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_28]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Integer integer=7
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_26]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
