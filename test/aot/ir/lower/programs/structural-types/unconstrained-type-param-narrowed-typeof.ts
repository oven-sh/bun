// RUN: lower
// OPTIONS: builtin-modules

// An unconstrained type parameter is narrowed by typeof.
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

function twice<T>(value: T): T | number | string | bigint {
  if (typeof value === "number") return value + value;
  if (typeof value === "string") return value + value;
  if (typeof value === "bigint") return value + value;
  return value;
}

function sizeOf<T>(value: T): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value | 0;
  if (typeof value === "function") return value.length;
  if (typeof value === "object" && value !== null) return Object.keys(value).length;
  return -1;
}

function at<T>(value: T, index: number): unknown {
  if (typeof value === "string") return value[index];
  if (Array.isArray(value)) return value[index];
  if (typeof value === "object" && value !== null && "length" in value) return value.length;
  return undefined;
}

function callIt<T>(value: T): unknown {
  if (typeof value === "function") return value();
  return "not called";
}

function truthy<T>(value: T): string {
  return value ? "truthy" : "falsy";
}

function same<T>(a: T, b: T): string {
  return (a === b) + " " + (a == b) + " " + Object.is(a, b);
}

function text<T>(value: T): string {
  return `${typeof value === "symbol" ? "a symbol" : value}`;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += sizeOf(i) + sizeOf(twice(i)) + (truthy(i) === "truthy" ? 1 : 0);
console.log("2000 rounds with integers: " + total);

class Point {
  x = 1;
  y = 2;
}

function study<T>(title: string, value: T): void {
  console.log(title);
  attempt("  twice", () => twice(value));
  attempt("  size", () => sizeOf(value));
  attempt("  at 1", () => at(value, 1));
  attempt("  at 99", () => at(value, 99));
  attempt("  called", () => callIt(value));
  attempt("  truthy", () => truthy(value));
  attempt("  same", () => same(value, value));
}

study("an integer", 21);
study("a fraction", 1.75);
study("a large number", 2 ** 31);
study("minus zero", -0);
study("not a number", NaN);
study("a string", "ab");
study("an empty string", "");
study("a big integer", 2n ** 64n);
study("true", true);
study("null", null);
study("undefined", undefined);
study("a list", [5, 6, 7]);
study("a point", new Point());
study("a function", () => "was called");
study("a class", Point);
study("a string object", new String("ab"));
study("a number object", new Number(3));
study("an array-like", { length: 2, 0: "a", 1: "b" });
attempt("texts", () => [text(1), text(-0), text("s"), text(null), text(undefined), text([1, [2]]), text(1n), text(Symbol("s")), text({})]);
attempt("zero and minus zero", () => same(0, -0));
attempt("a number and a string at a wider type argument", () => same<number | string>(1, "1"));
attempt("null and undefined at a wider type argument", () => same<null | undefined>(null, undefined));

export {};

// GENERATED: callIt truthy same text Point
// CHECK-LABEL: function {{*}}name="callIt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function} illTypedCause=Assertion
// CHECK-NEXT: v4 = Call v3 calleeName="value"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = String string="not called"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truthy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] site=[[w_4]]}] results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="truthy"
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = String string="falsy"
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b6(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]]}, {type=undefined|null|[[L_6]] site=[[w_8]]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Eq v0, v1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectIs
// CHECK-NEXT: v11 = Call v10, v9, v0, v1 calleeName="Object.is"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_11]] site=[[w_12]]}] results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=symbol
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="a symbol"
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b6(v5):
// CHECK-NEXT: v6 = ToString v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_15]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
