#!/usr/bin/env python3
"""generic-function-nested-results.py <folder>: ONE CASE A FOLDER. A generic function makes an object out of a spread of what is of type T, keeps it elsewhere, and lets it out at one place of its result. Asked at two places (inferred, annotated): is what stands there the same object, does a store show in the other holder, what are its fields.
What is made is always more than a copy (`{ ...x, g: 1 }`), and the type In has a field that is no primitive.
b-: the place is written as a bare T. i-: the place does not depend on T. k-: a field of a generic class. d-: a deep copy, a deep merge, mapped values. w-, s-: the made object lies within another. u-: the result is a union."""
import os
import sys

HEAD = r'''declare const console: { log(s: string): void };
interface In { n: number; tags: string[] }
interface R { a: number; b: string; inner: In }
const kept: object[] = []
'''
TAIL = r'''
const out: string[] = []
function tried(f: () => string): string { try { return f() } catch (e) { return "threw " + (e instanceof Error ? e.constructor.name : "something") } }
for (let turn = 0; turn < 3; turn++) {
  const r: R = { a: turn, b: "x" + turn, inner: { n: turn * 10, tags: ["t"] } }
  out.push("inferred: " + tried(() => { const at = kept.length; const w = CALL; const m = PATH; const same = (m as object) === kept[at]; STORE; return same + " " + SEEN + " " + READ }))
  out.push("annotated: " + tried(() => { const at = kept.length; const w: TYPE = CALL; const m = PATH; const same = (m as object) === kept[at]; STORE; return same + " " + SEEN + " " + READ }))
}
console.log(out.join("\n"))
'''
A = ('m.a = 100 + turn', '(kept[at] as R).a', 'm.a + m.b + m.inner.n')
N = ('m.n = 100 + turn', '(kept[at] as In).n', 'm.n + ":" + m.tags.length')
PROGRAMS = [
        ('b_a_property', 'function f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { v: made, k: 1 } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('b_a_property_the_literal_in_place', 'function f<T extends object>(x: T): { v: T; k: number } { const res = { v: { ...x, g: 1 }, k: 1 }; kept.push(res.v); return res }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('b_an_array_in_a_property', 'function f<T extends object>(x: T): { list: T[] } { const made = { ...x, g: 1 }; kept.push(made); return { list: [made] } }', 'f(r)', '{ list: R[] }', 'w.list[0]', A),
    ('b_a_tuple_in_a_property', 'function f<T extends object>(x: T): { pair: [T, number] } { const made = { ...x, g: 1 }; kept.push(made); return { pair: [made, 1] } }', 'f(r)', '{ pair: [R, number] }', 'w.pair[0]', A),
    ('b_or_undefined_in_a_property', 'function f<T extends object>(x: T): { v: T | undefined } { const made = { ...x, g: 1 }; kept.push(made); return { v: made } }', 'f(r)', '{ v: R | undefined }', 'w.v!', A),
    ('b_optional_property', 'function f<T extends object>(x: T): { v?: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { v: made, k: 1 } }', 'f(r)', '{ v?: R; k: number }', 'w.v!', A),
    ('b_two_deep', 'function f<T extends object>(x: T): { box: { v: T } } { const made = { ...x, g: 1 }; kept.push(made); return { box: { v: made } } }', 'f(r)', '{ box: { v: R } }', 'w.box.v', A),
    ('b_a_map_in_a_property', 'function f<T extends object>(x: T): { by: Map<string, T> } { const made = { ...x, g: 1 }; kept.push(made); return { by: new Map([["k", made]]) } }', 'f(r)', '{ by: Map<string, R> }', 'w.by.get("k")!', A),
    ('b_control_handed_in', 'function f<T extends object>(x: T): { v: T; k: number } { kept.push(x); return { v: x, k: 1 } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('b_control_the_result_itself', 'function f<T extends object>(x: T): T { const made = { ...x, g: 1 }; kept.push(made); return made }', 'f(r)', 'R', 'w', A),
    ('b_control_an_array_as_the_result', 'function f<T extends object>(x: T): T[] { const made = { ...x, g: 1 }; kept.push(made); return [made] }', 'f(r)', 'R[]', 'w[0]', A),
    ('i_by_a_variable', 'function f<T extends object>(x: T): { v: T; meta: In } { const made = { ...x, n: 7, tags: ["m"] }; kept.push(made); return { v: x, meta: made } }', 'f(r)', '{ v: R; meta: In }', 'w.meta', N),
    ('i_the_literal_in_place', 'function f<T extends object>(x: T): { v: T; meta: In } { const res = { v: x, meta: { ...x, n: 7, tags: ["m"] } }; kept.push(res.meta); return res }', 'f(r)', '{ v: R; meta: In }', 'w.meta', N),
    ('i_an_array', 'function f<T extends object>(x: T): { v: T; metas: In[] } { const made = { ...x, n: 7, tags: ["m"] }; kept.push(made); return { v: x, metas: [made] } }', 'f(r)', '{ v: R; metas: In[] }', 'w.metas[0]', N),
    ('i_control_no_spread', 'function f<T extends object>(x: T): { v: T; meta: In } { const made = { n: 7, tags: ["m"] }; kept.push(made); return { v: x, meta: made } }', 'f(r)', '{ v: R; meta: In }', 'w.meta', N),
    ('k_a_field_of_a_generic_class', 'class Box<V> { constructor(public v: V) {} }\nfunction f<T extends object>(x: T): { b: Box<T & { g: number }> } { const made = { ...x, g: 1 }; kept.push(made); return { b: new Box(made) } }', 'f(r)', '{ b: Box<R & { g: number }> }', 'w.b.v', A),
    ('k_a_field_of_a_generic_class_bare', 'class Box<V> { constructor(public v: V) {} }\nfunction f<T extends object>(x: T): { b: Box<T> } { const made = { ...x, g: 1 }; kept.push(made); return { b: new Box(made) } }', 'f(r)', '{ b: Box<R> }', 'w.b.v', A),
    ('d_a_deep_copy', 'function deep<T>(x: T): T { if (typeof x !== "object" || x === null || Array.isArray(x)) return x; const made = {} as Record<string, unknown>; for (const k of Object.keys(x)) made[k] = deep((x as Record<string, unknown>)[k]); kept.push(made); return made as T }\nfunction f<T extends object>(x: T): T { kept.length = kept.length; const res = { ...deep(x) }; return res }', 'f(r)', 'R', 'w.inner', N),
    ('d_a_deep_copy_by_literals', 'function f<T extends { inner: object }>(x: T): T { const made = { ...x.inner, g: 1 }; kept.push(made); const res = { ...x, inner: made }; return res }', 'f(r)', 'R', 'w.inner', N),
    ('d_a_deep_merge', 'function merge<T extends { inner: object }, U extends { inner: object }>(x: T, y: U): T & U { const made = { ...x.inner, ...y.inner }; kept.push(made); const res = { ...x, ...y, inner: made }; return res as T & U }', 'merge(r, { inner: { m: 1 } })', 'R & { inner: { m: number } }', 'w.inner', N),
    ('d_mapped_values', 'function each<T extends object>(x: T): { [K in keyof T]: T[K] } { const res = {} as { [K in keyof T]: T[K] }; for (const k of Object.keys(x) as (keyof T)[]) { const v = x[k]; if (typeof v === "object" && v !== null) { const made = { ...v, g: 1 }; kept.push(made); res[k] = made } else res[k] = v } return { ...res } }', 'each(r)', 'R', 'w.inner', N),
    ('w_a_later_argument_of_assign', 'function f<T extends object>(x: T): T & { v: T } { const made = { ...x, g: 1 }; kept.push(made); return Object.assign({ ...x }, { v: made }) }', 'f(r)', 'R & { v: R }', 'w.v', A),
    ('w_a_getter', 'function f<T extends object>(x: T): { readonly v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { get v() { return made }, k: 1 } }', 'f(r)', '{ readonly v: R; k: number }', 'w.v', A),
    ('w_a_method', 'function f<T extends object>(x: T): { v(): T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { v() { return made }, k: 1 } }', 'f(r)', '{ v(): R; k: number }', 'w.v()', A),
    ('w_an_array_of_holders', 'function f<T extends object>(x: T): { v: T }[] { const made = { ...x, g: 1 }; kept.push(made); return [{ v: made }] }', 'f(r)', '{ v: R }[]', 'w[0].v', A),
    ('w_arrays_in_arrays', 'function f<T extends object>(x: T): T[][] { const made = { ...x, g: 1 }; kept.push(made); return [[made]] }', 'f(r)', 'R[][]', 'w[0][0]', A),
    ('w_a_spread_of_a_holder', 'function f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); const base = { v: made }; return { ...base, k: 1 } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_stored_later', 'function f<T extends object>(x: T): { v?: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); const res: { v?: T; k: number } = { k: 1 }; res.v = made; return res }', 'f(r)', '{ v?: R; k: number }', 'w.v!', A),
    ('w_a_computed_key', 'function f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); const key: "v" = "v"; return { [key]: made, k: 1 } as { v: T; k: number } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_an_update_of_what_comes_from_t', 'function f<T extends { inner: In }>(s: T): T { const made = { ...s.inner, n: 5, g: 1 }; kept.push(made); return { ...s, inner: made } }', 'f(r)', 'R', 'w.inner', N),
    ('w_an_update_two_deep', 'interface Deep { a: number; mid: { inner: In; z: string[] } }\nfunction f<T extends Deep>(s: T): T { const made = { ...s.mid.inner, n: 5, g: 1 }; kept.push(made); return { ...s, mid: { ...s.mid, inner: made } } }', 'f({ a: r.a, mid: { inner: r.inner, z: ["z"] } } as Deep)', 'Deep', 'w.mid.inner', N),
    ('w_through_an_identity_function', 'function id<U>(u: U): U { return u }\nfunction f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { v: id<T>(made), k: 1 } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_a_for_of_variable', 'function f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); for (const m of [made]) return { v: m, k: 1 }; throw new Error("none") }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_a_spread_of_from_entries', 'function f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { ...Object.fromEntries([["v", made]]), k: 1 } as { v: T; k: number } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_out_of_an_instance', 'class Wrap<V> { constructor(public value: V) {} }\nfunction f<T extends object>(x: T): { v: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); return { v: new Wrap<T>(made).value, k: 1 } }', 'f(r)', '{ v: R; k: number }', 'w.v', A),
    ('w_filled_by_a_helper', 'function fill<V>(res: { v?: V }, m: V): void { res.v = m }\nfunction f<T extends object>(x: T): { v?: T; k: number } { const made = { ...x, g: 1 }; kept.push(made); const res: { v?: T; k: number } = { k: 1 }; fill<T>(res, made); return res }', 'f(r)', '{ v?: R; k: number }', 'w.v!', A),
    ('w_pushed_later', 'function f<T extends object>(x: T): { list: T[]; k: number } { const made = { ...x, g: 1 }; kept.push(made); const res: { list: T[]; k: number } = { list: [], k: 1 }; res.list.push(made); return res }', 'f(r)', '{ list: R[]; k: number }', 'w.list[0]', A),
    ('s_a_named_type', 'interface Named { a: number; b: string; inner: In; g: number }\nfunction f<T extends object>(x: T): T & { g: number } { const made = { ...x, g: 1 }; kept.push(made); return made }', 'f(r)', 'Named', 'w', A),
    ('s_a_narrower_type', 'function f<T extends object>(x: T): T & { g: number } { const made = { ...x, g: 1 }; kept.push(made); return made }', 'f(r)', '{ a: number; b: string; inner: In }', 'w', A),
    ('s_or_undefined', 'function f<T extends object>(x: T): T & { g: number } { const made = { ...x, g: 1 }; kept.push(made); return made }', 'f(r)', '(R & { g: number }) | undefined', 'w!', A),
    ('s_another_name_within', 'interface Inner2 { a: number; b: string; inner: In; h: number }\ninterface Outer2 { k: number; part: Inner2 }\nfunction f<T extends object>(x: T): { k: number; part: T & { h: number } } { const made = { ...x, h: 1 }; kept.push(made); return { k: 1, part: made } }', 'f(r)', 'Outer2', 'w.part', A),
    ('s_a_narrower_type_within', 'function f<T extends object>(x: T): { k: number; part: T & { h: number } } { const made = { ...x, h: 1 }; kept.push(made); return { k: 1, part: made } }', 'f(r)', '{ part: { a: number; b: string; inner: In } }', 'w.part', A),
    ('s_held_on_as_another', 'interface Named { a: number; b: string; inner: In }\nfunction on(n: Named): Named { return n }\nfunction f<T extends object>(x: T): T & { g: number } { const made = { ...x, g: 1 }; kept.push(made); return made }', 'on(f(r))', 'Named', 'w', A),
    ('u_or_undefined', 'function f<T extends object>(x: T): (T & { g: number }) | undefined { const made = { ...x, g: 1 }; kept.push(made); return kept.length < 0 ? undefined : made }', 'f(r)', '(R & { g: number }) | undefined', 'w!', A),
    ('u_one_of_two_is_made', 'function f<T extends object>(x: T): (T & { g: number }) | { none: true } { const made = { ...x, g: 1 }; kept.push(made); return kept.length < 0 ? { none: true } : made }', 'f(r)', '(R & { g: number }) | { none: true }', '(w as R & { g: number })', A),
    ('u_bare_or_a_record', 'function f<T extends object>(x: T): T | { none: true } { const made = { ...x, g: 1 }; kept.push(made); return kept.length < 0 ? { none: true } : made }', 'f(r)', 'R | { none: true }', '(w as R)', A),
    ('u_by_a_tag', 'function f<T extends object>(x: T): { ok: true; value: T & { g: number } } | { ok: false; error: string } { const made = { ...x, g: 1 }; kept.push(made); return kept.length < 0 ? { ok: false, error: "e" } : { ok: true, value: made } }', 'f(r)', '{ ok: true; value: R & { g: number } } | { ok: false; error: string }', '(w.ok ? w.value : (undefined as never))', A),
    ('u_by_a_tag_bare', 'function f<T extends object>(x: T): { ok: true; value: T } | { ok: false; error: string } { const made = { ...x, g: 1 }; kept.push(made); return kept.length < 0 ? { ok: false, error: "e" } : { ok: true, value: made } }', 'f(r)', '{ ok: true; value: R } | { ok: false; error: string }', '(w.ok ? w.value : (undefined as never))', A),
    ('u_t_is_a_union', 'interface S { a: number; b: string; inner: In; s: boolean }\nfunction f<T extends object>(x: T): T & { g: number } { const made = { ...x, g: 1 }; kept.push(made); return made }\nfunction either(r: R): R | S { return r.a < 0 ? { ...r, s: true } : r }', 'f(either(r))', '(R | S) & { g: number }', 'w', A),
]


def write(folder, name, text):
    case = os.path.join(folder, name.replace('_', '-'))
    os.makedirs(case, exist_ok=True)
    open(os.path.join(case, 'main.ts'), 'w').write(text)


def main():
    folder = sys.argv[1]
    for name, text, call, sink, path, (store, seen, read) in PROGRAMS:
        tail = TAIL.replace('CALL', call).replace('TYPE', sink).replace('PATH', path).replace('STORE', store).replace('SEEN', seen).replace('READ', read)
        write(folder, name, HEAD + text + tail)
    print('%d programs in %s' % (len(PROGRAMS), folder))


main()
