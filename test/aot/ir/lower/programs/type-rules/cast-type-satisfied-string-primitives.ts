// RUN: lower
// OPTIONS: builtin-modules

// `x as T` never converts. A type that a string satisfies (ArrayLike, Iterable, { length: number }, String), alone or in a union, takes a string as it is.
// A primitive that does not satisfy the type throws a TypeError. A type parameter tests nothing.
declare const console: { log(...values: unknown[]): void };
interface HasLength { length: number }
const values: unknown[] = [123, 12.5, true, false, 10n, "ab"];
function attempt(label: string, run: (value: unknown) => unknown): void {
  console.log(label + ": " + values.map(value => { try { const got = run(value); return typeof got === "bigint" ? got + "n" : JSON.stringify(got); } catch (error) { return "threw " + (error as Error).name; } }).join(" "));
}
function isArrayLike(value?: any): boolean { return value != null && typeof value !== "function" && typeof (value as ArrayLike<unknown>).length === "number"; }
function items(collection: unknown): string[] { const list = collection as ArrayLike<unknown>; return Array.from(list).map(String); }
function generic<T extends ArrayLike<unknown>>(value: unknown): string { return typeof (value as T); }

attempt("isArrayLike", value => isArrayLike(value));
attempt("items", value => items(value));
attempt("ArrayLike<unknown>", value => typeof (value as ArrayLike<unknown>));
attempt("{ length: number }", value => typeof (value as { length: number }));
attempt("HasLength", value => typeof (value as HasLength));
attempt("Iterable<string>", value => typeof (value as Iterable<string>));
attempt("String", value => typeof (value as String));
attempt("string | object", value => typeof (value as string | object));
attempt("readonly unknown[] | string", value => typeof (value as readonly unknown[] | string));
attempt("string | ArrayLike<string>", value => typeof (value as string | ArrayLike<string>));
attempt("number | Date", value => typeof (value as number | Date));
attempt("a type parameter", value => generic(value));
attempt("length through the cast", value => (value as ArrayLike<unknown>).length);
attempt("length through { length: number }", value => (value as { length: number }).length);
attempt("the value itself", value => value as ArrayLike<unknown>);
attempt("double cast", value => typeof (value as unknown as Iterable<unknown>));
attempt("from any", value => { const given: any = value; return typeof (given as ArrayLike<unknown>); });

// GENERATED: isArrayLike items generic attempt
// CHECK-LABEL: function {{*}}name="isArrayLike"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = TypeTest v0 testedType=function
// CHECK-NEXT: v6 = LogicalNot v5
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = PropGet v11 key="length"
// CHECK-NEXT: v13 = TypeTest v12 testedType=number
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="items"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v3 = IsPristineArray v1
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v4, v1
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v9, v8
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v14 = Builtin builtin=ArrayFrom [isNotReadFromHolder]
// CHECK-NEXT: v15 = Call v14, v13, v12
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = PropGet v17 key="map"
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="map" calleeName="map"
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="values"
// CHECK-NEXT: v11 = PropGet v10 key="map"
// CHECK-NEXT: v12 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Add v8, v18
// CHECK-NEXT: v20 = Call v6, v4, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
