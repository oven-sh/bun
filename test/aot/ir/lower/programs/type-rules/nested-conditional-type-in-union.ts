// RUN: lower
// OPTIONS: builtin-modules

// TypeScript's base constraint of `NoUndefined<Output<T>>` is `never`, although the type has values once T is known (zod's `.default(value)`).
// A deferred type whose constraint is `never` says nothing about the values a generic function is given.
type NoUndefined<T> = T extends undefined ? never : T;
interface Schema<Output = unknown> { _output: Output }
type Output<T> = T extends { _output: any } ? T["_output"] : never;
const text: Schema<string> = { _output: "" };
const count: Schema<number | undefined> = { _output: 1 };
const point: Schema<{ x: number }> = { _output: { x: 1 } };

function alone<T extends Schema>(inner: T, value: NoUndefined<Output<T>>): unknown { return value; }
function inUnion<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | number[]): unknown { return value; }
function orUndefined<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | undefined): unknown { return value; }
function optional<T extends Schema>(inner: T, value?: NoUndefined<Output<T>>): unknown { return value; }
function excluded<T extends Schema>(inner: T, value: Exclude<Output<T>, undefined> | number[]): unknown { return value; }
function twice<T extends Schema>(inner: T, value: NoUndefined<NoUndefined<Output<T>>> | null): unknown { return value; }
function intersected<T extends Schema>(inner: T, value: (NoUndefined<Output<T>> & {}) | number[]): unknown { return value; }
function inField<T extends Schema>(inner: T, holder: { held: NoUndefined<Output<T>> | number[] }): unknown { return holder.held; }
function inArray<T extends Schema>(inner: T, values: (NoUndefined<Output<T>> | null)[]): unknown { return values[0]; }
function returned<T extends Schema>(inner: T): NoUndefined<Output<T>> | undefined { return inner._output as NoUndefined<Output<T>>; }
function orFactory<T extends Schema>(inner: T, value: NoUndefined<Output<T>> | (() => NoUndefined<Output<T>>)): unknown { return typeof value === "function" ? (value as () => unknown)() : value; }
class Defaulted<T extends Schema> {
  constructor(public inner: T, public value: NoUndefined<Output<T>> | undefined) {}
  get(): NoUndefined<Output<T>> | undefined { return this.value; }
}

console.log(alone(text, "a"), inUnion(text, "a"), String(inUnion(text, [1])), orUndefined(text, "a"), orUndefined(text, undefined), optional(text, "a"), optional(text));
console.log(excluded(text, "a"), twice(text, "a"), twice(text, null), intersected(text, "a"), inField(text, { held: "a" }), inArray(text, ["a", null]), returned(text));
console.log(inUnion(count, 2), optional(count, 2), excluded(count, 2), new Defaulted(count, 2).get(), new Defaulted(text, "a").get(), new Defaulted(text, undefined).get());
console.log(JSON.stringify([inUnion(point, { x: 2 }), optional(point, { x: 3 }), inField(point, { held: { x: 4 } }), new Defaulted(point, { x: 5 }).get()]));
console.log(orFactory(text, "a"), orFactory(text, () => "made"), orFactory(count, 3), orFactory(count, () => 4));

interface Parser<Out> { parse(value: unknown): Out }
type Infer<S> = S extends Parser<infer Out> ? Out : never;
interface Tool { inputSchema?: Parser<unknown> }
function validate<T extends Tool, Args extends T["inputSchema"] extends infer S ? (S extends Parser<unknown> ? Infer<S> : undefined) : undefined>(tool: T, args: Args): Args {
  return tool.inputSchema ? args : (undefined as Args);
}
const tool = { inputSchema: { parse: (value: unknown) => value as { a: number } } };
console.log(JSON.stringify(validate(tool, { a: 1 })), validate({}, undefined));

type Procedure = (input: number) => number;
interface RouterRecord { [key: string]: Procedure | RouterRecord }
type Decorated<P> = P extends (input: infer I) => infer O ? (input: I) => O : never;
type DecorateRecord<R extends RouterRecord> = { [K in keyof R]: R[K] extends infer V ? (V extends Procedure ? Decorated<V> : V extends RouterRecord ? DecorateRecord<V> : never) : never };
function pick<R extends RouterRecord, K extends keyof R>(record: DecorateRecord<R>, key: K): DecorateRecord<R>[K] { return record[key]; }
function kindOf<R extends RouterRecord, K extends keyof R>(value: DecorateRecord<R>[K]): string { return typeof value; }
const routes = { double: (n: number) => n * 2, nested: { triple: (n: number) => n * 3 } };
console.log(pick<typeof routes, "double">(routes, "double")(2), pick<typeof routes, "nested">(routes, "nested").triple(2), kindOf<typeof routes, "double">(routes.double), kindOf<typeof routes, "nested">(routes.nested));

type Unwrapped<T> = T extends readonly (infer E)[] ? Unwrapped<E> : T;
function innermost<T>(value: T, fallback: Unwrapped<T> | null): unknown { return fallback; }
type Picked<T> = T extends { kind: "text" } ? string : T extends { kind: "count" } ? number : boolean;
function picked<T extends { kind: string }>(tag: T, value: Picked<T> | undefined): unknown { return value; }
console.log(innermost([[1]], 2), innermost("a", "b"), innermost([["x"]], null), picked({ kind: "text" as const }, "t"), picked({ kind: "count" as const }, 3), picked({ kind: "other" }, true));

// GENERATED: optional inArray validate kindOf picked Defaulted get double
// CHECK-LABEL: function {{*}}name="optional"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inArray"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] site=[[w_4]]}, {type=undefined|null|Array<null> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]], v1: undefined|null|Array<null>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = ElemGet v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=null site=[[w_6]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="validate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_8]]}, {type=undefined|null|[[L_9]] site=[[w_10]]}] results=[{type=undefined|null|[[L_9]] site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]], v1: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="inputSchema"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_12]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b6(v1)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_9]] site=[[w_13]]}
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_9]] site=[[w_11]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="picked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]] site=[[w_16]]}, {type=undefined|null|boolean|number|string site=[[w_17]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_15]], v1: undefined|null|boolean|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Defaulted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_18]] site=[[w_19]]}, {type=undefined site=[[w_20]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_18]], v2: undefined):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_21]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_21]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_22]]
// CHECK-NEXT: PropSet v5, v1 key="inner"
// CHECK-NEXT: PropSet v5, v2 key="value"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_21]] site=[[w_23]]} results=[{type=undefined site=[[w_24]]}] {
// CHECK-NEXT: b0(v0: [[L_21]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined site=[[w_24]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_25]]}] results=[{type=number site=[[w_26]]}] functionTypes={{*}}[[f_27]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_26]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
