#!/usr/bin/env python3
"""well-typed-values-of-generic-types.py <n>: a value that satisfies its type is never refused, where the type is still open: an indexed access, a mapped, conditional or template literal
type over a type parameter of a generic function or class.
The n-th of 55 programs, one per type: the type stands in ten places (a parameter, beside null, optional, in a union, in an array, in a field, a result, a local, a callback's result, a class's field)
and each place is given every well-typed value listed for the type. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys
PRELUDE = '''declare const console: { log(...a: unknown[]): void };
class Point { constructor(public x: number, public y: number) {} norm() { return this.x + this.y; } }
interface Named { name: string }
const show = (v: unknown): string => typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : v instanceof Point ? "Point " + v.norm() : v instanceof Map ? "Map " + v.size : v instanceof Date ? "Date" : v instanceof Promise ? "Promise" : JSON.stringify(v) ?? "undefined";
'''
ATTEMPT = 'function attempt(label: string, run: () => unknown): void { let said: string; try { said = show(run()); } catch (error) { said = "threw " + (error as Error).name; } console.log(label + ": " + said); }\n'
TYPES = [
 ("indexed", "", "T, K extends keyof T", "T, key: K", "T[K]", [('{ a: 1, b: "s" }, "a"', '2'), ('{ a: 1, b: "s" }, "b"', '"t"'), ('new Point(1, 2), "x"', '3'), ('[1, 2], 0', '5'), ('{ f: () => 1 }, "f"', '() => 2')]),
 ("indexed-all", "", "T", "T", "T[keyof T]", [('{ a: 1, b: "s" }', '"t"'), ('{ a: 1, b: "s" }', '2'), ('{ p: new Point(1, 2) }', 'new Point(3, 4)'), ('{ a: [1] }', '[2]')]),
 ("keyof", "", "T", "T", "keyof T", [('{ a: 1, b: 2 }', '"a"'), ('[1, 2]', '0'), ('[1, 2]', '"length"'), ('{ 1: "x" }', '1'), ('{ [Symbol.iterator]: 1 }', 'Symbol.iterator')]),
 ("partial", "", "T", "T", "Partial<T>", [('{ a: 1, b: "s" }', '{ a: 2 }'), ('{ a: 1, b: "s" }', '{}'), ('new Point(1, 2)', '{ x: 1 }'), ('[1, 2]', '[3]')]),
 ("required", "", "T", "T", "Required<T>", [('{ a: 1 } as { a?: number }', '{ a: 2 }'), ('new Point(1, 2)', 'new Point(3, 4)')]),
 ("readonly", "", "T", "T", "Readonly<T>", [('{ a: 1 }', '{ a: 2 }'), ('[1, 2]', '[3, 4]'), ('new Point(1, 2)', 'new Point(3, 4)'), ('"s"', '"t"'), ('1', '2')]),
 ("pick", "", "T, K extends keyof T", "T, key: K", "Pick<T, K>", [('{ a: 1, b: "s" }, "a"', '{ a: 2 }'), ('new Point(1, 2), "x"', '{ x: 3 }'), ('new Point(1, 2), "x"', 'new Point(5, 6)')]),
 ("omit", "", "T, K extends keyof T", "T, key: K", "Omit<T, K>", [('{ a: 1, b: "s" }, "a"', '{ b: "t" }'), ('new Point(1, 2), "norm"', '{ x: 3, y: 4 }')]),
 ("record", "", "K extends string, V", "K, held: V", "Record<K, V>", [('"a", 1', '{ a: 2 }'), ('"a" as "a" | "b", "s"', '{ a: "x", b: "y" }'), ('"k" as string, new Point(1, 2)', '{ any: new Point(3, 4) }')]),
 ("exclude", "", "T", "T", "Exclude<T, undefined>", [('1 as number | undefined', '2'), ('"s" as string | undefined', '"t"'), ('new Point(1, 2) as Point | undefined', 'new Point(3, 4)'), ('[1] as number[] | undefined', '[2]'), ('(() => 1) as (() => number) | undefined', '() => 2')]),
 ("extract", "", "T", "T", "Extract<T, string | number>", [('1 as number | boolean', '2'), ('"s" as string | Point', '"t"')]),
 ("nonnullable", "", "T", "T", "NonNullable<T>", [('1 as number | null', '2'), ('"s" as string | undefined', '"t"'), ('new Point(1, 2) as Point | null', 'new Point(3, 4)'), ('true as boolean | null', 'false'), ('1n as bigint | null', '2n')]),
 ("returntype", "", "F extends (...a: any[]) => any", "F", "ReturnType<F>", [('() => 1', '2'), ('() => "s"', '"t"'), ('() => new Point(1, 2)', 'new Point(3, 4)'), ('() => [1]', '[2]'), ('() => () => 1', '() => 2'), ('() => {}', 'undefined'), ('async () => 1', 'Promise.resolve(2)')]),
 ("parameters", "", "F extends (...a: any[]) => any", "F", "Parameters<F>", [('(a: number, b: string) => 1', '[1, "s"]'), ('() => 1', '[]'), ('(...a: number[]) => 1', '[1, 2, 3]')]),
 ("parameter0", "", "F extends (...a: any[]) => any", "F", "Parameters<F>[0]", [('(a: number) => 1', '2'), ('(a: string) => 1', '"t"'), ('(a: Point) => 1', 'new Point(3, 4)'), ('(a: () => void) => 1', '() => {}')]),
 ("awaited", "", "P", "P", "Awaited<P>", [('Promise.resolve(1)', '2'), ('Promise.resolve("s")', '"t"'), ('1', '2'), ('Promise.resolve(new Point(1, 2))', 'new Point(3, 4)'), ('Promise.resolve(Promise.resolve([1]))', '[2]')]),
 ("instancetype", "", "C extends new (...a: any[]) => any", "C", "InstanceType<C>", [('Point', 'new Point(3, 4)'), ('Map', 'new Map()'), ('Date', 'new Date(0)'), ('class { z = 1 }', '{ z: 2 }')]),
 ("ctorparameters", "", "C extends new (...a: any[]) => any", "C", "ConstructorParameters<C>", [('Point', '[1, 2]')]),
 ("template", "", "S extends string", "S", "`on${S}`", [('"a"', '"ona"'), ('"x" as "x" | "y"', '"ony"')]),
 ("template-cap", "", "S extends string", "S", "`on${Capitalize<S>}`", [('"click"', '"onClick"')]),
 ("uppercase", "", "S extends string", "S", "Uppercase<S>", [('"a"', '"A"')]),
 ("element", "type Element<A> = A extends readonly (infer E)[] ? E : never;", "A", "A", "Element<A>", [('[1, 2]', '3'), ('["s"]', '"t"'), ('[new Point(1, 2)]', 'new Point(3, 4)'), ('[[1]]', '[2]'), ('[() => 1]', '() => 2'), ('[1, "s"] as (number | string)[]', '"t"')]),
 ("element-indexed", "", "A extends readonly unknown[]", "A", "A[number]", [('[1, 2]', '3'), ('["s"]', '"t"'), ('[new Point(1, 2)]', 'new Point(3, 4)'), ('[1, "s"] as [number, string]', '"t"')]),
 ("first", "type First<A> = A extends [infer H, ...unknown[]] ? H : undefined;", "A extends unknown[]", "A", "First<A>", [('[1, "s"] as [number, string]', '2'), ('[] as []', 'undefined'), ('["s"] as [string]', '"t"')]),
 ("tail", "type Tail<A> = A extends [unknown, ...infer R] ? R : [];", "A extends unknown[]", "A", "Tail<A>", [('[1, "s"] as [number, string]', '["t"]'), ('[] as []', '[]')]),
 ("variadic", "", "A extends unknown[]", "A", "[...A, boolean]", [('[1, "s"] as [number, string]', '[2, "t", true]'), ('[] as []', '[false]')]),
 ("unpromise-fn", "type Result<F> = F extends (...a: any[]) => Promise<infer R> ? R : F extends (...a: any[]) => infer R ? R : never;", "F", "F", "Result<F>", [('async () => 1', '2'), ('() => "s"', '"t"'), ('async () => new Point(1, 2)', 'new Point(3, 4)')]),
 ("deep-partial", "type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;", "T", "T", "DeepPartial<T>", [('{ a: { b: 1, c: "s" } }', '{ a: { b: 2 } }'), ('{ a: { b: 1 } }', '{}'), ('1', '2'), ('"s"', '"t"'), ('{ a: [1] }', '{ a: [2] }')]),
 ("deep-readonly", "type DeepReadonly<T> = T extends (infer E)[] ? readonly DeepReadonly<E>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;", "T", "T", "DeepReadonly<T>", [('{ a: [1] }', '{ a: [2] }'), ('[{ a: 1 }]', '[{ a: 2 }]'), ('1', '2')]),
 ("nondistributive", "type IsString<T> = [T] extends [string] ? \"yes\" : 0;", "T", "T", "IsString<T>", [('"s"', '"yes"'), ('1', '0')]),
 ("boxed", "type Boxed<T> = T extends string ? { text: T } : T extends number ? { count: T } : { other: T };", "T", "T", "Boxed<T>", [('"s"', '{ text: "s" }'), ('1', '{ count: 1 }'), ('true', '{ other: true }'), ('new Point(1, 2)', '{ other: new Point(3, 4) }')]),
 ("fn-of", "type Handler<T> = T extends string ? (text: T) => void : (value: T) => number;", "T", "T", "Handler<T>", [('"s"', '(t: string) => {}'), ('1', '(n: number) => n')]),
 ("mapped-as", "type Getters<T> = { [K in keyof T & string as `get${Capitalize<K>}`]: () => T[K] };", "T", "T", "Getters<T>", [('{ a: 1 }', '{ getA: () => 2 }')]),
 ("mapped-values", "type Boxes<T> = { [K in keyof T]: { value: T[K] } };", "T", "T", "Boxes<T>", [('{ a: 1, b: "s" }', '{ a: { value: 2 }, b: { value: "t" } }'), ('[1, "s"] as [number, string]', '[{ value: 2 }, { value: "t" }]')]),
 ("mapped-value-of", "type Boxes<T> = { [K in keyof T]: { value: T[K] } };", "T, K extends keyof T", "T, key: K", "Boxes<T>[K]", [('{ a: 1, b: "s" }, "a"', '{ value: 2 }'), ('{ a: 1, b: "s" }, "b"', '{ value: "t" }')]),
 ("mapped-value-inner", "type Boxes<T> = { [K in keyof T]: { value: T[K] } };", "T, K extends keyof T", "T, key: K", "Boxes<T>[K][\"value\"]", [('{ a: 1, b: "s" }, "a"', '2'), ('{ a: 1, b: "s" }, "b"', '"t"')]),
 ("constraint-cond", "type Arg<T> = T extends Named ? string : number;", "T, A extends Arg<T>", "T", "A", [('{ name: "n" }', '"s"'), ('1', '2')]),
 ("default-param", "", "T, D = T extends string ? number : string", "T", "D", [('"s"', '1'), ('1', '"t"')]),
 ("this-like", "type Self<T> = T extends { self: infer S } ? S : T;", "T", "T", "Self<T>", [('{ self: 1 }', '2'), ('{ self: "s" }', '"t"'), ('5', '6'), ('{ self: new Point(1, 2) }', 'new Point(3, 4)')]),
 ("union-to-fn", "type ToFn<T> = T extends unknown ? (x: T) => void : never;", "T", "T", "ToFn<T>", [('1', '(x: number) => {}')]),
 ("keys-of-kind", "type KeysOf<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];", "T", "T", "KeysOf<T, string>", [('{ a: 1, b: "s" }', '"b"')]),
 ("values-of-kind", "type KeysOf<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];", "T", "T", "T[KeysOf<T, string>]", [('{ a: 1, b: "s" }', '"t"')]),
 ("infer-constraint", "type Num<T> = T extends [infer N extends number] ? N : never;", "T", "T", "Num<T>", [('[1] as [1]', '1')]),
 ("flatten", "type Flat<T> = T extends readonly (infer E)[] ? Flat<E> : T;", "T", "T", "Flat<T>", [('[[1]]', '2'), ('"s"', '"t"'), ('[[[new Point(1, 2)]]]', 'new Point(3, 4)')]),
 ("json", "type Json<T> = T extends Date ? string : T extends (...a: any[]) => any ? never : T extends object ? { [K in keyof T]: Json<T[K]> } : T;", "T", "T", "Json<T>", [('{ at: new Date(0), n: 1 }', '{ at: "x", n: 2 }'), ('new Date(0)', '"d"'), ('1', '2')]),
 ("getter-result", "type Values<T> = { [K in keyof T]: T[K] extends () => infer R ? R : T[K] };", "T", "T", "Values<T>", [('{ a: () => 1, b: "s" }', '{ a: 2, b: "t" }')]),
 ("homomorphic-readonly", "", "T", "T", "Readonly<T>", [('"s" as string', '"t"'), ('1 as number', '2'), ('true as boolean', 'false'), ('1n as bigint', '2n'), ('null', 'null'), ('undefined', 'undefined'), ('Symbol.iterator as symbol', 'Symbol.iterator'), ('(() => 1) as () => number', '() => 2'), ('"s" as string | Point', '"t"'), ('"s" as string | Point', 'new Point(1, 2)')]),
 ("homomorphic-partial", "", "T", "T", "Partial<T>", [('"s" as string', '"t"'), ('1 as number', '2'), ('true as boolean', 'false'), ('null', 'null'), ('1 as number | Named', '2'), ('1 as number | Named', '{}')]),
 ("homomorphic-required", "", "T", "T", "Required<T>", [('"s" as string', '"t"'), ('1 as number', '2')]),
 ("homomorphic-own", "type Same<T> = { [K in keyof T]: T[K] };", "T", "T", "Same<T>", [('"s" as string', '"t"'), ('1 as number', '2'), ('[1] as number[]', '[2]'), ('new Point(1, 2)', 'new Point(3, 4)')]),
 ("homomorphic-mutable", "type Mutable<T> = { -readonly [K in keyof T]: T[K] };", "T", "T", "Mutable<T>", [('"s" as string', '"t"'), ('1 as number', '2'), ('[1] as readonly number[]', '[2]')]),
 ("homomorphic-nested", "", "T", "T", "Readonly<Partial<T>>", [('"s" as string', '"t"'), ('1 as number', '2'), ('{ a: 1 }', '{}')]),
 ("homomorphic-boxes", "type Boxes<T> = { [K in keyof T]: { value: T[K] } };", "T", "T", "Boxes<T>", [('"s" as string', '"t"'), ('1 as number', '2')]),
 ("homomorphic-constrained", "", "T extends string | number | Named", "T", "Readonly<T>", [('"s" as string', '"t"'), ('1 as number', '2'), ('{ name: "n" }', '{ name: "m" }')]),
 ("homomorphic-indexed", "", "T, K extends keyof T", "T, key: K", "Readonly<T[K]>", [('{ a: 1 as number, b: "s" as string }, "a"', '2'), ('{ a: 1 as number, b: "s" as string }, "b"', '"t"'), ('{ a: { c: 1 } }, "a"', '{ c: 2 }')]),
]
PLACES = {
 'alone': ('function f<%(tp)s>(first: %(ft)s, value: %(ty)s): unknown { return value; }', 'f(%(x)s, %(v)s)'),
 'or-null': ('function f<%(tp)s>(first: %(ft)s, value: %(ty)s | null): unknown { return value; }', 'f(%(x)s, %(v)s)'),
 'optional': ('function f<%(tp)s>(first: %(ft)s, value?: %(ty)s): unknown { return value; }', 'f(%(x)s, %(v)s)'),
 'or-array': ('function f<%(tp)s>(first: %(ft)s, value: %(ty)s | symbol[]): unknown { return value; }', 'f(%(x)s, %(v)s)'),
 'in-array': ('function f<%(tp)s>(first: %(ft)s, values: (%(ty)s)[]): unknown { return values[0]; }', 'f(%(x)s, [%(v)s])'),
 'in-field': ('function f<%(tp)s>(first: %(ft)s, holder: { held: %(ty)s }): unknown { return holder.held; }', 'f(%(x)s, { held: %(v)s })'),
 'returned': ('function f<%(tp)s>(first: %(ft)s, value: unknown): %(ty)s { return value as %(ty)s; }', 'f(%(x)s, %(v)s)'),
 'local': ('function f<%(tp)s>(first: %(ft)s, value: %(ty)s): unknown { let kept: %(ty)s | undefined; kept = value; const list: (%(ty)s)[] = []; list.push(kept); return list[0]; }', 'f(%(x)s, %(v)s)'),
 'callback': ('function f<%(tp)s>(first: %(ft)s, make: () => %(ty)s): unknown { const made: %(ty)s = make(); return made; }', 'f(%(x)s, () => (%(v)s))'),
 'class-field': ('class Holder<%(tp)s> { held: %(ty)s; constructor(first: %(ft)s, held: %(ty)s) { this.held = held; } get(): %(ty)s { return this.held; } }', 'new Holder(%(x)s, %(v)s).get()'),
}
# Combinations that TypeScript rejects, mostly because a literal type is inferred for the type parameter.
ILL_TYPED = set("""awaited.in-array.0 awaited.in-array.1 awaited.in-array.3 ctorparameters.callback.0 deep-partial.callback.2 deep-partial.callback.3 deep-partial.in-array.2 deep-partial.in-array.3
deep-partial.in-field.2 deep-partial.in-field.3 deep-readonly.callback.2 deep-readonly.in-array.2 deep-readonly.in-field.2 flatten.callback.1 flatten.in-array.1 flatten.in-field.1
instancetype.local.0 instancetype.local.1 instancetype.local.2 instancetype.local.3 json.callback.2 json.in-array.2 json.in-field.2 keyof.callback.3
keyof.callback.4 parameters.callback.0 parameters.callback.1 readonly.alone.3 readonly.alone.4 readonly.callback.3 readonly.callback.4 readonly.class-field.3
readonly.class-field.4 readonly.in-array.3 readonly.in-array.4 readonly.in-field.3 readonly.in-field.4 readonly.local.3 readonly.local.4 readonly.optional.3
readonly.optional.4 readonly.or-array.3 readonly.or-array.4 readonly.or-null.3 readonly.or-null.4 record.class-field.0 record.class-field.1 record.class-field.2
returntype.local.0 returntype.local.1 returntype.local.2 returntype.local.3 returntype.local.4 returntype.local.5 returntype.local.6 this-like.callback.2
this-like.in-array.2 this-like.in-field.2""".split())
if sys.argv[1] == 'names': print('\n'.join(t[0] for t in TYPES)); sys.exit()
name, aliases, parameters, first, deferred, cases = next(t for n, t in enumerate(TYPES) if sys.argv[1] in (str(n), t[0]))
print(PRELUDE + ATTEMPT + aliases)
for place, (declaration, call) in PLACES.items():
    for i, (given, value) in enumerate(cases):
        if '%s.%s.%d' % (name, place, i) in ILL_TYPED: continue
        words = dict(tp=parameters, ft=first, ty=deferred, x=given, v=value); suffix = '_%s_%d' % (place.replace('-', '_'), i)
        print((declaration % words).replace('function f<', 'function f%s<' % suffix).replace('class Holder<', 'class Holder%s<' % suffix))
        print('attempt("%s %d", () => %s);' % (place, i, (call % words).replace('f(', 'f%s(' % suffix, 1).replace('new Holder(', 'new Holder%s(' % suffix, 1)))
