// RUN: lower
// OPTIONS: builtin-modules

// `Readonly<string>` is `string`: a mapped type over `keyof T` applied to a primitive type is that primitive type. So a generic function's
// `Readonly<T>`, `Partial<T>` or `{ [K in keyof T]: .. }` holds primitives whenever T can be one.
declare const console: { log(...a: unknown[]): void };
class Point { constructor(public x: number, public y: number) {} norm() { return this.x + this.y; } }
interface Named { name: string }
type Same<T> = { [K in keyof T]: T[K] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Boxes<T> = { [K in keyof T]: { value: T[K] } };
const show = (v: unknown): string => typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : v instanceof Point ? "Point " + v.norm() : JSON.stringify(v) ?? "undefined";

function parameter<T>(first: T, value: Readonly<T>): unknown { return value; }
function orNull<T>(first: T, value: Readonly<T> | null): unknown { return value; }
function optional<T>(first: T, value?: Partial<T>): unknown { return value; }
function orArray<T>(first: T, value: Required<T> | symbol[]): unknown { return value; }
function inArray<T>(first: T, values: Same<T>[]): unknown { return values[0]; }
function inField<T>(first: T, holder: { held: Mutable<T> }): unknown { return holder.held; }
function returned<T>(first: T, value: unknown): Readonly<T> { return value as Readonly<T>; }
function local<T>(first: T, value: Readonly<T>): unknown { let kept: Readonly<T> | undefined; kept = value; const list: Readonly<T>[] = []; list.push(kept); return list[0]; }
function callback<T>(first: T, make: () => Boxes<T>): unknown { const made: Boxes<T> = make(); return made; }
function nested<T>(first: T, value: Readonly<Partial<T>>): unknown { return value; }
function constrained<T extends string | number | Named>(first: T, value: Readonly<T>): unknown { return value; }
function indexed<T, K extends keyof T>(first: T, key: K, value: Readonly<T[K]>): unknown { return value; }
function kind<T>(first: T, value: Readonly<T>): string { return typeof value; }
function objectsOnly<T extends Named>(first: T, value: Readonly<T>): string { return value.name; }
class Holder<T> { held: Readonly<T>; constructor(first: T, held: Readonly<T>) { this.held = held; } get(): Readonly<T> { return this.held; } }

const text = "s" as string, count = 1 as number, flag = true as boolean, big = 1n as bigint, unique = Symbol.iterator as symbol;
console.log(show(parameter(text, "t")), show(parameter(count, 2)), show(parameter(flag, false)), show(parameter(big, 2n)), show(parameter(unique, Symbol.iterator)), show(parameter(null, null)), show(parameter(undefined, undefined)));
console.log(show(parameter(() => 1, () => 2)), show(parameter(new Point(1, 2), new Point(3, 4))), show(parameter([1], [2])), show(parameter({ a: 1 }, { a: 2 })), show(parameter(text as string | Point, "t")), show(parameter(text as string | Point, new Point(5, 6))));
console.log(show(orNull(text, "t")), show(orNull(count, null)), show(optional(text, "t")), show(optional(count)), show(optional({ a: 1 }, {})), show(orArray(text, "t")), show(orArray(count, 2)), show(orArray(count, [])));
console.log(show(inArray(text, ["t"])), show(inArray(count, [2])), show(inField(text, { held: "t" })), show(inField(count, { held: 2 })), show(returned(text, "t")), show(returned(count, 2)), show(local(text, "t")), show(local(count, 2)));
console.log(show(callback(text, () => "t")), show(callback(count, () => 2)), show(callback({ a: 1 }, () => ({ a: { value: 2 } }))), show(nested(text, "t")), show(nested({ a: 1 }, {})), show(constrained(text, "t")), show(constrained(count, 2)), show(constrained({ name: "n" }, { name: "m" })));
console.log(show(indexed({ a: count, b: text }, "a", 2)), show(indexed({ a: count, b: text }, "b", "t")), show(indexed({ a: { c: 1 } }, "a", { c: 2 })), kind(text, "t"), kind(count, 2), kind({ a: 1 }, { a: 2 }), objectsOnly({ name: "n" }, { name: "m" }));
console.log(show(new Holder(text, "t").get()), show(new Holder(count, 2).get()), show(new Holder(new Point(1, 2), new Point(7, 8)).get()));

// GENERATED: local callback kind objectsOnly norm Holder
// CHECK-LABEL: function {{*}}name="local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = ElemGet v4, v8
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: v2 = Call v1 calleeName="make"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="objectsOnly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]], v1: anything):
// CHECK-NEXT: v2 = PropGet v1 key="name"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="norm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: PropSet v5, v2 key="held"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
