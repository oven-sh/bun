#!/usr/bin/env python3
"""well-typed-values-of-unusual-types.py <n>: a value that satisfies its type is never refused, for types that are not a plain class, record or primitive: branded primitives, `{}`, interfaces
that primitives satisfy, callable objects, constructors, tuples with optional and rest elements, index signatures, ArrayLike, Iterable, enums, literal and template literal types, wrappers,
built-in classes and their subclasses, unions told apart by a member, recursive types, variance.
The n-th of 100 programs, one per type: the type stands in twelve places (a parameter, beside null, optional, in an array, in a field, a result, a local, a callback's result, a class's field,
a parameter given an `any`, a module variable, a Map's value) and each place is given every well-typed value listed for the type. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys
PRELUDE = '''declare const console: { log(...a: unknown[]): void };
class Point { constructor(public x: number, public y: number) {} norm() { return this.x + this.y; } }
class Point3 extends Point { constructor(x: number, y: number, public z: number) { super(x, y); } }
abstract class Shape { abstract area(): number; describe() { return "area " + this.area(); } }
class Square extends Shape { constructor(public side: number) { super(); } area() { return this.side * this.side; } }
class Failure extends Error { code = 7; }
class Counts extends Map<string, number> { total() { let n = 0; for (const v of this.values()) n += v; return n; } }
interface Named { name: string }
interface Sized { length: number }
enum Color { Red, Green = 5, Blue }
enum Word { A = "a", B = "b" }
const enum Bit { One = 1, Two = 2 }
const tag: unique symbol = Symbol("tag");
function* letters() { yield "a"; yield "b"; }
const show = (v: unknown): string => typeof v === "function" ? "function " + v.name : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : v instanceof Point ? "Point " + v.norm() : v instanceof Shape ? v.describe() : v instanceof Map ? "Map " + v.size : v instanceof Set ? "Set " + v.size : v instanceof Date ? "Date" : v instanceof Promise ? "Promise" : v instanceof Error ? v.name + " " + v.message : v instanceof RegExp ? String(v) : ArrayBuffer.isView(v) ? "view " + v.byteLength : typeof v === "object" && v !== null && Symbol.iterator in v && !Array.isArray(v) ? "iterable" : JSON.stringify(v) ?? "undefined";
'''
ATTEMPT = 'function attempt(label: string, run: () => unknown): void { let said: string; try { said = show(run()); } catch (error) { said = "threw " + (error as Error).name; } console.log(label + ": " + said); }\n'
TYPES = [
 ("branded-string", "type Id = string & { readonly __brand: \"id\" };", "Id", ['"a" as Id']),
 ("branded-number", "type Cents = number & { readonly __unit: \"cents\" };", "Cents", ['5 as Cents']),
 ("string-and-empty", "", "string & {}", ['"a"']),
 ("open-literal-union", "", '"a" | "b" | (string & {})', ['"a"', '"zzz"']),
 ("open-number-union", "", '1 | 2 | (number & {})', ['1', '77']),
 ("empty-object", "", "{}", ['1', '"s"', 'true', '1n', 'tag', '{}', '[]', '() => 1', 'new Point(1, 2)']),
 ("object-interface", "", "Object", ['1', '"s"', '{}', '[]', '() => 1']),
 ("object-keyword", "", "object", ['{}', '[]', '() => 1', 'new Point(1, 2)', 'new Map()', '/x/', 'Point']),
 ("sized", "", "Sized", ['"abc"', '[1, 2]', '(a: number) => a', '{ length: 3 }', 'new Uint8Array(2)']),
 ("has-tostring", "", "{ toString(): string }", ['5', '"s"', 'true', '{}', '[1]', 'new Point(1, 2)', '1n', 'tag']),
 ("has-valueof", "", "{ valueOf(): number }", ['5', 'new Date(0)', '{ valueOf: () => 1 }']),
 ("has-tofixed", "", "{ toFixed(digits?: number): string }", ['5', '{ toFixed: () => "x" }']),
 ("has-charat", "", "{ charAt(at: number): string }", ['"s"']),
 ("callable-with-property", "", "{ (x: number): number; label: string }", ['Object.assign((x: number) => x, { label: "l" })']),
 ("constructor-value", "", "typeof Point", ['Point', 'Point3']),
 ("construct-signature", "", "new (x: number, y: number) => Point", ['Point']),
 ("abstract-construct", "", "abstract new () => Shape", ['Shape']),
 ("abstract-instance", "", "Shape", ['new Square(2)']),
 ("tuple-optional", "", "[number, string?]", ['[1]', '[1, "s"]', '[1, undefined]']),
 ("tuple-rest", "", "[number, ...string[]]", ['[1]', '[1, "a", "b"]']),
 ("tuple-leading-rest", "", "[...number[], boolean]", ['[true]', '[1, 2, false]']),
 ("tuple-readonly", "", "readonly [number, string]", ['[1, "s"]', '[1, "s"] as const']),
 ("tuple-named", "", "[x: number, y?: number]", ['[1]', '[1, 2]']),
 ("tuple-empty", "", "[]", ['[]']),
 ("string-index", "", "{ [key: string]: number }", ['{}', '{ a: 1 }', '{ a: 1, 2: 3 }']),
 ("number-index", "", "{ [index: number]: string }", ['["a"]', '{ 0: "a" }', '"str"', '{}']),
 ("symbol-index", "", "{ [key: symbol]: number }", ['{}', '{ [tag]: 1 }']),
 ("template-index", "", "{ [key: `data-${string}`]: string }", ['{}', '{ "data-a": "x" }']),
 ("record-unknown", "", "Record<string, unknown>", ['{}', '{ a: 1, b: "s" }', '{ f: () => 1 }']),
 ("record-literal-keys", "", 'Record<"a" | "b", number>', ['{ a: 1, b: 2 }']),
 ("record-number-keys", "", "Record<number, string>", ['["a"]', '{ 1: "x" }']),
 ("record-enum-keys", "", "Record<Color, string>", ['{ [Color.Red]: "r", [Color.Green]: "g", [Color.Blue]: "b" }']),
 ("arraylike-number", "", "ArrayLike<number>", ['[1]', 'new Uint8Array(2)', '{ length: 1, 0: 5 }']),
 ("arraylike-string", "", "ArrayLike<string>", ['"abc"', '["a"]']),
 ("iterable-string", "", "Iterable<string>", ['"abc"', '["a"]', 'new Set(["a"])', 'letters()', 'new Map([["a", 1]]).keys()']),
 ("iterable-pairs", "", "Iterable<readonly [string, number]>", ['new Map([["a", 1]])', '[["a", 1]] as [string, number][]', 'new Counts()']),
 ("promiselike", "", "PromiseLike<number>", ['Promise.resolve(1)', '{ then(resolve: any) { return resolve(1); } } as PromiseLike<number>']),
 ("numeric-enum", "", "Color", ['Color.Red', 'Color.Green', '5', 'Color.Blue | 0']),
 ("enum-member", "", "Color.Green", ['Color.Green']),
 ("string-enum", "", "Word", ['Word.A', 'Word.B']),
 ("const-enum", "", "Bit", ['Bit.One', 'Bit.One | Bit.Two']),
 ("enum-object", "", "typeof Color", ['Color']),
 ("number-literals", "", "1 | 2 | 3", ['1', '3']),
 ("negative-literal", "", "-1 | 0.5 | 1e21", ['-1', '0.5', '1e21']),
 ("mixed-literals", "", '0 | "" | false | null | undefined | 0n', ['0', '""', 'false', 'null', 'undefined', '0n']),
 ("bigint-literal", "", "1n | 2n", ['1n']),
 ("template-literal", "", "`a${number}`", ['"a1"', '"a1.5"']),
 ("template-union", "", '`${"x" | "y"}-${"1" | "2"}`', ['"x-1"', '"y-2"']),
 ("unique-symbol", "", "typeof tag", ['tag']),
 ("function-interface", "", "Function", ['() => 1', 'Point', 'function named() {}', 'async () => 1', 'letters']),
 ("error", "", "Error", ['new Error("e")', 'new TypeError("t")', 'new Failure("f")', '{ name: "n", message: "m" }']),
 ("map-subclass", "", "Map<string, number>", ['new Map()', 'new Counts()']),
 ("readonly-map", "", "ReadonlyMap<string, number>", ['new Map()', 'new Counts()']),
 ("readonly-set", "", "ReadonlySet<number>", ['new Set([1])']),
 ("buffer-view", "", "ArrayBufferView", ['new Uint8Array(2)', 'new DataView(new ArrayBuffer(4))', 'new Float64Array(1)']),
 ("typed-or-array", "", "Int8Array | number[]", ['new Int8Array(1)', '[1]']),
 ("void", "", "void", ['undefined']),
 ("never-array", "", "never[]", ['[]']),
 ("unknown-array", "", "readonly unknown[]", ['[]', '[1, "s"]', '[1, "s"] as const', '[1, "s"] as [number, string]']),
 ("accessor-pair", "", "{ get size(): number; set size(value: number | string) }", ['{ size: 1 }', '{ get size() { return 2; }, set size(v: number | string) {} }']),
 ("optional-method", "", "{ run?(): number; name: string }", ['{ name: "n" }', '{ name: "n", run() { return 1; } }', '{ name: "n", run: undefined }']),
 ("interface-from-class", "interface Extended extends Point { label: string }", "Extended", ['Object.assign(new Point(1, 2), { label: "l" })']),
 ("structural-class", "", "Point", ['new Point(1, 2)', 'new Point3(1, 2, 3)', '{ x: 1, y: 2, norm() { return 9; } }']),
 ("interface-by-class", "", "Named", ['{ name: "n" }', 'new (class { name = "c"; extra = 1 })()', 'new Error("e")', 'function named() {}', 'Point']),
 ("partial-class", "", "Partial<Point>", ['{}', '{ x: 1 }', 'new Point(1, 2)']),
 ("pick-class", "", 'Pick<Point, "x">', ['{ x: 1 }', 'new Point(1, 2)']),
 ("omit-class", "", 'Omit<Point, "norm">', ['{ x: 1, y: 2 }', 'new Point(1, 2)']),
 ("readonly-class", "", "Readonly<Point>", ['new Point(1, 2)', 'Object.freeze(new Point(1, 2))']),
 ("intersection", "", "Named & Sized", ['{ name: "n", length: 1 }', 'function named(a: number) {}']),
 ("class-and-interface", "", "Point & Named", ['Object.assign(new Point(1, 2), { name: "n" })']),
 ("boolean-discriminant", "", "{ ok: true; value: number } | { ok: false; error: string }", ['{ ok: true, value: 1 }', '{ ok: false, error: "e" }']),
 ("null-discriminant", "", "{ error: null; value: number } | { error: string }", ['{ error: null, value: 1 }', '{ error: "e" }']),
 ("number-discriminant", "", "{ code: 200; body: string } | { code: 404 }", ['{ code: 200, body: "b" }', '{ code: 404 }']),
 ("missing-discriminant", "", "{ a: number; b?: undefined } | { b: string; a?: undefined }", ['{ a: 1 }', '{ b: "s" }']),
 ("recursive", "type Tree = { value: number; children: Tree[] };", "Tree", ['{ value: 1, children: [] }', '{ value: 1, children: [{ value: 2, children: [] }] }']),
 ("json", "type Json = null | boolean | number | string | Json[] | { [key: string]: Json };", "Json", ['null', 'true', '1', '"s"', '[1, [2]]', '{ a: { b: [null] } }']),
 ("overloaded-function", "", "{ (x: number): number; (x: string): string }", ['((x: any) => x) as { (x: number): number; (x: string): string }']),
 ("symbol-key", "", "{ [tag]: number }", ['{ [tag]: 1 }']),
 ("iterator-key", "", "{ [Symbol.iterator](): Iterator<number> }", ['[1]', 'new Set([1])', 'new Uint8Array(1)']),
 ("number-or-bigint", "", "number | bigint", ['1', '1n']),
 ("primitive-or-wrapper", "", "string | String", ['"s"', 'new String("w")']),
 ("wrapper", "", "Number", ['5', 'new Number(6)']),
 ("boolean-wrapper", "", "Boolean", ['true', 'new Boolean(false)']),
 ("symbol-wrapper", "", "Symbol", ['tag']),
 ("bigint-wrapper", "", "BigInt", ['1n']),
 ("array-or-one", "", "number | number[]", ['1', '[1]']),
 ("nested-arrays", "", "(number | string[])[][]", ['[]', '[[1, ["a"]]]']),
 ("function-or-value", "", "number | (() => number)", ['1', '() => 2']),
 ("date-or-number", "", "Date | number | string", ['new Date(0)', '1', '"s"']),
 ("regexp-or-string", "", "RegExp | string", ['/x/g', '"s"']),
 ("weak-key", "", "WeakKey", ['{}', 'tag', '() => 1']),
 ("property-key", "", "PropertyKey", ['"a"', '1', 'tag']),
 ("this-typed", "class Chain { n = 0; add(): this { this.n++; return this; } } class Longer extends Chain { more = 1; }", "Chain", ['new Chain().add()', 'new Longer().add()']),
 ("generic-instance", "class Box<T> { constructor(public held: T) {} }", "Box<number | string>", ['new Box<number | string>(1)', 'new Box<number | string>("s")']),
 ("generic-variance", "class Box<T> { constructor(public readonly held: T) {} }", "Box<number | string>", ['new Box(1)', 'new Box("s")']),
 ("array-variance", "", "(number | string)[]", ['[1] as number[]', '["s"] as string[]']),
 ("array-of-base", "", "Point[]", ['[new Point3(1, 2, 3)] as Point3[]', '[new Point(1, 2), new Point3(1, 2, 3)]']),
 ("method-bivariance", "", "{ take(p: Point): number }", ['{ take(p: Point3) { return p.x; } }']),
 ("fewer-parameters", "", "(a: number, b: string) => number", ['() => 1', '(a: number) => a']),
 ("void-return", "", "() => void", ['() => 1', '() => "s"', 'async () => {}']),
]
PLACES = {
 'parameter': ('function f(value: %(ty)s): unknown { return value; }', 'f(%(v)s)'),
 'or-null': ('function f(value: %(ty2)s | null): unknown { return value; }', 'f(%(v)s)'),
 'optional': ('function f(value?: %(ty)s): unknown { return value; }', 'f(%(v)s)'),
 'in-array': ('function f(values: (%(ty)s)[]): unknown { return values[0]; }', 'f([%(v)s])'),
 'in-field': ('function f(holder: { held: %(ty)s }): unknown { return holder.held; }', 'f({ held: %(v)s })'),
 'returned': ('function f(): %(ty)s { return %(v)s; }', 'f()'),
 'local': ('function f(value: %(ty)s): unknown { let kept: %(ty2)s | undefined; kept = value; const list: (%(ty)s)[] = []; list.push(kept); return list[0]; }', 'f(%(v)s)'),
 'callback': ('function f(make: () => %(ty)s): unknown { const made: %(ty)s = make(); return made; }', 'f(() => (%(v)s))'),
 'class-field': ('class Holder { held: %(ty)s; constructor(held: %(ty)s) { this.held = held; } get(): %(ty)s { return this.held; } }', 'new Holder(%(v)s).get()'),
 'from-any': ('const given: any = %(v)s;\nfunction f(value: %(ty)s): unknown { return value; }', 'f(given)'),
 'module-variable': ('let kept: %(ty)s = %(v)s;\nfunction f(): unknown { return kept; }', 'f()'),
 'map-value': ('const table = new Map<string, %(ty)s>();\nfunction f(value: %(ty)s): unknown { table.set("k", value); return table.get("k"); }', 'f(%(v)s)'),
}
# Combinations that TypeScript rejects, mostly because a literal type is inferred for the type parameter.
ILL_TYPED = set("""accessor-pair.callback.1 accessor-pair.class-field.1 accessor-pair.in-array.1 accessor-pair.in-field.1 accessor-pair.local.1 accessor-pair.map-value.1 accessor-pair.module-variable.1 accessor-pair.optional.1
accessor-pair.or-null.1 accessor-pair.parameter.1 accessor-pair.returned.1 constructor-value.callback.1 constructor-value.class-field.1 constructor-value.in-array.1 constructor-value.in-field.1 constructor-value.local.1
constructor-value.map-value.1 constructor-value.module-variable.1 constructor-value.optional.1 constructor-value.or-null.1 constructor-value.parameter.1 constructor-value.returned.1""".split())
if sys.argv[1] == 'names': print('\n'.join(t[0] for t in TYPES)); sys.exit()
name, aliases, written, values = next(t for n, t in enumerate(TYPES) if sys.argv[1] in (str(n), t[0]))
print(PRELUDE + ATTEMPT + aliases)
for place, (declaration, call) in PLACES.items():
    for i, value in enumerate(values):
        if '%s.%s.%d' % (name, place, i) in ILL_TYPED: continue
        words = dict(ty=written, ty2='(' + written + ')', v=value); suffix = '_%s_%d' % (place.replace('-', '_'), i)
        renamed = lambda text: text.replace('function f(', 'function f%s(' % suffix).replace('class Holder ', 'class Holder%s ' % suffix).replace('const given:', 'const given%s:' % suffix).replace('let kept: %s =' % written, 'let kept%s: %s =' % (suffix, written)).replace('return kept; }', 'return kept%s; }' % suffix if place == 'module-variable' else 'return kept; }').replace('const table =', 'const table%s =' % suffix).replace('table.', 'table%s.' % suffix)
        print(renamed(declaration % words))
        print('attempt("%s %d", () => %s);' % (place, i, (call % words).replace('f(given)', 'f%s(given%s)' % (suffix, suffix)).replace('f(', 'f%s(' % suffix, 1).replace('new Holder(', 'new Holder%s(' % suffix, 1) if 'given)' not in call else 'f%s(given%s)' % (suffix, suffix)))
