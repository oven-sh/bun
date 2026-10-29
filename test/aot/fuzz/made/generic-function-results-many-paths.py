#!/usr/bin/env python3
"""generic-function-results-many-paths.py <folder>: ONE CASE A FOLDER. Inside `function wide<T extends object>(r: T, i: number)` the type T says nothing of a layout, so `{ ...r, g: i }` is an ordinary object; at the call the instantiated type does. The object must come out as it is: not refused, and not copied, for it has another holder.
One case a road: how the object gets from its birth to the result (r-*), or how the generic function is reached (c-*). Every program keeps the object elsewhere too and asks at three places (the result inferred, into an annotated variable, as an argument): is it the same object, does a store show in the other holder, what are its fields."""
import os
import sys

HEAD = r'''declare const console: { log(s: string): void };
interface R { a: number; b: string }
type W<T> = T & { g: number }
const kept: { g: number }[] = []
'''
TAIL = r'''
const out: string[] = []
function tried(f: () => string): string { try { return f() } catch (e) { return "threw " + (e instanceof Error ? e.constructor.name : "something") } }
for (let turn = 0; turn < 3; turn++) {
  const r: R = { a: turn, b: "x" + turn }
  out.push("inferred: " + tried(() => { const at = kept.length; const w = CALL(r, 7); const same = (w as object) === kept[at]; w.g = 8; return same + " " + kept[at].g + " " + w.a + w.b + w.g + " " + Object.keys(w).join() }))
  out.push("annotated: " + tried(() => { const at = kept.length; const v: R & { g: number } = CALL(r, 9); const same = (v as object) === kept[at]; v.g = 10; return same + " " + kept[at].g + " " + v.a + v.b + v.g + " " + Object.keys(v).join() }))
  out.push("an argument: " + tried(() => { const at = kept.length; return take(CALL(r, 11), at) }))
}
function take(v: R & { g: number }, at: number): string { const same = (v as object) === kept[at]; v.g = 12; return same + " " + kept[at].g + " " + v.a + v.b + v.g }
console.log(out.join("\n"))
'''
L = '{ ...r, g: i }'
ROADS = [
    ('the_control_a_literal_in_a_variable', '', 'const made = %s' % L),
    ('destructured_out_of_a_holder', '', 'const holder = { made: %s }; const { made } = holder' % L),
    ('destructured_out_of_an_array', '', 'const [made] = [%s]' % L),
    ('a_for_of_variable', '', 'let made!: W<T>; for (const m of [%s]) made = m' % L),
    ('a_closure_that_returns_it', '', 'const m = %s; const get = () => m; const made = get()' % L),
    ('a_getter', '', 'const m = %s; const holder = { get it() { return m } }; const made = holder.it' % L),
    ('from_entries', '', 'const made = Object.fromEntries([...Object.entries(r), ["g", i]]) as W<T>'),
    ('object_create_and_assign', '', 'const made = Object.create(Object.prototype) as W<T>; Object.assign(made, r, { g: i })'),
    ('new_object_and_assign', '', 'const made = new Object() as W<T>; Object.assign(made, r, { g: i })'),
    ('json_there_and_back', '', 'const made = JSON.parse(JSON.stringify(%s)) as W<T>' % L),
    ('a_constructor_that_returns_a_literal', 'class Maker { constructor(r: object, i: number) { return { ...r, g: i } } }\n', 'const made = new Maker(r, i) as unknown as W<T>'),
    ('a_tagged_template', 'function tag<U>(s: TemplateStringsArray, v: U): U { return v }\n', 'const m = %s; const made = tag`${m}`' % L),
    ('an_element_of_an_array', '', 'const box = [%s]; const made = box[0]' % L),
    ('out_of_a_set', '', 'const box = new Set([%s]); const made = [...box][0]' % L),
    ('out_of_a_weak_map', '', 'const key = {}; const box = new WeakMap<object, W<T>>(); box.set(key, %s); const made = box.get(key)!' % L),
    ('thrown_and_caught', '', 'let made!: W<T>; try { throw %s } catch (e) { made = e as W<T> }' % L),
    ('yielded', '', 'const m = %s; function* all() { yield m } const made = all().next().value as W<T>' % L),
    ('mapped', '', 'const made = [r].map((x) => ({ ...x, g: i }))[0]'),
    ('reduced', '', 'const made = Object.entries(r).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), { g: i } as W<T>)'),
    ('through_an_identity_function', 'function id<U>(u: U): U { return u }\n', 'const made = id(%s)' % L),
    ('through_two_identity_functions', 'function id<U>(u: U): U { return u }\nfunction id2<U>(u: U): U { const v = id(u); return v }\n', 'const m = %s; const made = id2(m)' % L),
    ('through_this_of_a_method', '', 'const holder = { m: %s, get() { return this.m } }; const made = holder.get()' % L),
    ('a_spread_argument', 'function first<U>(...all: U[]): U { return all[0] }\n', 'const made = first(...[%s])' % L),
    ('an_optional_chain', '', 'const holder: { m: W<T> } | undefined = { m: %s }; const made = holder?.m as W<T>' % L),
    ('a_computed_key', '', 'const holder = { m: %s }; const k: "m" = "m"; const made = holder[k]' % L),
    ('object_values', '', 'const holder = { m: %s }; const made = Object.values(holder)[0]' % L),
    ('assigned_by_nullish', '', 'let made: W<T> | undefined; made ??= %s' % L),
    ('assigned_by_or', '', 'let made: W<T> | undefined; made ||= %s' % L),
    ('assigned_in_a_nested_closure', '', 'let made!: W<T>; [1].forEach(() => { made = %s })' % L),
    ('assigned_by_destructuring', '', 'let made: W<T>; ({ made } = { made: %s })' % L),
    ('a_field_of_an_instance', '', 'class Holder { m = %s } const made = new Holder().m' % L),
    ('by_call_apply_and_reflect', 'function make<U extends object>(r: U, i: number): W<U> { return { ...r, g: i } }\n', 'const made = i === 7 ? make.call(null, r, i) as W<T> : i === 9 ? make.apply(null, [r, i]) as W<T> : Reflect.apply(make, null, [r, i]) as W<T>'),
    ('a_parameter_stored_anew', '', 'let x: object = r; x = %s; const made = x as W<T>' % L),
    ('a_switch_statement', '', 'let made: W<T>; switch (i) { case 7: made = %s; break; case 9: { const m = %s; made = m; break } default: made = %s }' % (L, L, L)),
    ('a_finally', '', 'let made: W<T>; try { made = %s } finally { void 0 }' % L),
    ('a_label_and_a_loop', '', 'let made!: W<T>; outer: for (;;) { for (;;) { made = %s; break outer } }' % L),
    ('a_class_static', '', 'class Holder { static m: object } Holder.m = %s; const made = Holder.m as W<T>' % L),
    ('a_module_variable', 'let last: object = {}\n', 'last = %s; const made = last as W<T>' % L),
    ('a_property_stored_later', '', 'const holder: { m?: W<T> } = {}; holder.m = %s; const made = holder.m' % L),
    ('a_thenable', '', 'let made!: W<T>; ({ then(f: (v: W<T>) => void) { f(%s) } }).then((v) => { made = v })' % L),
]
BODY = '{ const made = { ...r, g: i }; kept.push(made); return made }'
WIDE = 'function wide<T extends object>(r: T, i: number): W<T> %s\n' % BODY
CALLEES = [
    ('an_arrow', 'const wide = <T extends object>(r: T, i: number): W<T> => %s\n' % BODY, 'wide'),
    ('an_arrow_inferred', 'const wide = <T extends object>(r: T, i: number) => %s\n' % BODY, 'wide'),
    ('a_function_expression', 'const wide = function <T extends object>(r: T, i: number): W<T> %s\n' % BODY, 'wide'),
    ('a_method_of_a_literal', 'const lib = { wide<T extends object>(r: T, i: number): W<T> %s }\n' % BODY, 'lib.wide'),
    ('a_static_method', 'class Lib { static wide<T extends object>(r: T, i: number): W<T> %s }\n' % BODY, 'Lib.wide'),
    ('a_method_of_an_instance', 'class Lib { wide<T extends object>(r: T, i: number): W<T> %s }\nconst lib = new Lib()\n' % BODY, 'lib.wide'),
    ('a_method_of_a_generic_class', 'class Box<T extends object> { wide(r: T, i: number): W<T> %s }\nconst box = new Box<R>()\n' % BODY, 'box.wide'),
    ('held_in_a_variable', WIDE + 'const f = wide\n', 'f'),
    ('out_of_an_array', WIDE + 'const fs = [wide]\n', 'fs[0]'),
    ('one_of_two', WIDE + 'function wide2<T extends object>(r: T, i: number): W<T> { const made = { g: i, ...r }; kept.push(made); return made }\n', '(kept.length & 1 ? wide : wide2)'),
    ('handed_to_a_generic_apply', WIDE + 'function apply<A, C>(f: (a: A, i: number) => C, a: A, i: number): C { return f(a, i) }\nfunction viaApply(r: R, i: number): W<R> { return apply(wide<R>, r, i) }\n', 'viaApply'),
    ('handed_to_a_generic_apply_by_a_generic', WIDE + 'function apply<A, C>(f: (a: A, i: number) => C, a: A, i: number): C { return f(a, i) }\nconst viaApply = <T extends object>(r: T, i: number) => apply(wide<T>, r, i)\n', 'viaApply'),
    ('curried', 'function wideBy(i: number) { return <T extends object>(r: T): W<T> => %s }\nfunction uncurried<T extends object>(r: T, i: number): W<T> { return wideBy(i)(r) }\n' % BODY, 'uncurried'),
    ('overloaded', 'function wide<T extends object>(r: T, i: number): W<T>\nfunction wide(r: object, i: number): object %s\n' % BODY, 'wide'),
    ('bound', WIDE + 'const bound = wide.bind(null) as typeof wide\n', 'bound'),
    ('a_generic_that_calls_a_plain_maker', 'function plainly(r: object, i: number): { g: number } %s\nfunction wide<T extends object>(r: T, i: number): W<T> { return plainly(r, i) as W<T> }\n' % BODY, 'wide'),
    ('recursive', 'function wide<T extends object>(r: T, i: number, deep: number = 2): W<T> { if (deep) return wide(r, i, deep - 1); const made = { ...r, g: i }; kept.push(made); return made }\n', 'wide'),
    ('two_that_call_one_another', 'function ping<T extends object>(r: T, i: number, deep: number = 3): W<T> { if (deep) return pong(r, i, deep - 1); const made = { ...r, g: i }; kept.push(made); return made }\nfunction pong<T extends object>(r: T, i: number, deep: number): W<T> { if (deep) return ping(r, i, deep - 1); const made = { ...r, g: i }; kept.push(made); return made }\n', 'ping'),
    ('two_that_call_one_another_the_literal_in_the_second_alone', 'function ping<T extends object>(r: T, i: number, deep: number = 3): W<T> { return pong(r, i, deep - 1) }\nfunction pong<T extends object>(r: T, i: number, deep: number): W<T> { if (deep > 0) return ping(r, i, deep); const made = { ...r, g: i }; kept.push(made); return made }\n', 'ping'),
]


def write(folder, name, text):
    case = os.path.join(folder, name.replace('_', '-'))
    os.makedirs(case, exist_ok=True)
    open(os.path.join(case, 'main.ts'), 'w').write(text)


def main():
    folder = sys.argv[1]
    for name, ahead, body in ROADS:
        write(folder, 'r_' + name, HEAD + ahead + 'function wide<T extends object>(r: T, i: number): W<T> { %s; kept.push(made); return made }' % body + TAIL.replace('CALL', 'wide'))
    for name, text, callee in CALLEES:
        write(folder, 'c_' + name, HEAD + text + TAIL.replace('CALL', callee))
    print('%d roads, %d callees in %s' % (len(ROADS), len(CALLEES), folder))


main()
