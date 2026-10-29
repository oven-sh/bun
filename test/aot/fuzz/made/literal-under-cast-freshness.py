#!/usr/bin/env python3
"""literal-under-cast-freshness.py <folder>: The cast of a literal under `satisfies`, `as`, `!` or `as const` is a cast of what is fresh, so it may copy. IS IT FRESH? Each row tries to hold the object by another road before the cast, or to see that it was copied. P has 60 optional members and is given by its looks (`JSON.parse(..) as Config` shares one of them); the literal has a spread, so it is born empty. One road a program, because types that rows share change what is laid out. """
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
N=60
HEAD='declare const console: { log(...values: unknown[]): void };\ninterface P { timeout?: number; '+' '.join('o%d?: number;'%i for i in range(N))+' x?: number; y?: string; m?: () => unknown; inner?: P; readonly g?: number }\ninterface Config { timeout?: number; retries?: number }\nconst config = JSON.parse(\'{"timeout":5}\') as Config;\nfunction f(b: number): Omit<P, "x" | "y" | "m" | "inner" | "g"> { return { timeout: b, '+', '.join('o%d: %d'%(i,i) for i in range(N))+' } }\nfunction take(p: P): number { let s = (p.timeout ?? 0) + (p.x ?? 0); s += (p.o0 ?? 0) + (p.o59 ?? 0); return s }\nfunction words(e: unknown): string { return "THROWN: " + (e as Error).name }\n'
rows={
 'a01_satisfies':'const o = { ...f(1), x: 1, y: "y" } satisfies P;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'a02_as':'const o = { ...f(1), x: 1, y: "y" } as P;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'a03_satisfies_then_as':'const o = ({ ...f(1), x: 1, y: "y" } satisfies P) as P;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'a04_as_then_satisfies':'const o = ({ ...f(1), x: 1, y: "y" } as P) satisfies P;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'a05_non_null':'const o = ({ ...f(1), x: 1, y: "y" } satisfies P)!;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'a06_as_const':'const o = { ...f(1), x: 1, y: "y" } as const satisfies P;\nconsole.log(take(o), Object.keys(o).length, o.y);',
 'b01_an_assignment_inside':'let tmp: object | undefined;\nconst o = (tmp = { ...f(1), x: 1 }) satisfies P;\nconsole.log(tmp === o, take(o)); (tmp as P).x = 7; console.log(o.x, take(o));',
 'b02_a_comma_inside':'let n = 0;\nconst o = (n++, { ...f(1), x: 1 }) satisfies P;\nconsole.log(n, take(o));',
 'b03_a_conditional_inside':'const o = (config.timeout ? { ...f(1), x: 1 } : { ...f(2), x: 2 }) satisfies P;\nconsole.log(take(o));',
 'b04_a_name_inside':'const made = { ...f(1), x: 1 } satisfies P;\nconst o = made satisfies P; const q = made as P; const r = made!;\nconsole.log(o === made, q === made, r === made, take(o)); made.x = 9; console.log(o.x, q.x, r.x);',
 'c01_a_method_sees_this':'let seen: unknown;\nconst o = { ...f(1), x: 1, m() { seen = this; return 1 } } satisfies P;\no.m(); console.log(seen === o, take(o));',
 'c02_a_method_names_the_variable':'const o: P = { ...f(1), x: 1, m() { return o } } satisfies P;\nconsole.log(o.m!() === o, take(o));',
 'c03_an_arrow_in_it_holds_the_outer_this':'class K { v = 3; make() { return { ...f(1), x: 1, m: () => this.v } satisfies P } }\nconst o = new K().make(); console.log(o.m(), take(o));',
 'c04_a_getter_in_it':'let calls = 0;\nconst o = { ...f(1), x: 1, get g() { calls++; return 5 } } satisfies P;\nconsole.log(calls, o.g, calls, o.g, calls, Object.getOwnPropertyDescriptor(o, "g")!.get !== undefined, take(o));',
 'c05_super_in_a_method':'const o = { ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } } satisfies P;\nconsole.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c06_the_spread_source_has_a_getter_that_keeps_things':'const kept: unknown[] = [];\nconst src = { get timeout() { kept.push(this); return 4 } };\nconst o = { ...f(1), ...src, x: 1 } satisfies P;\nconsole.log(kept.length, kept[0] === src, kept[0] === o, take(o));',
 'd01_stored_to_afterwards':'const o = { ...f(1), x: 1 } satisfies P as P;\nconst alias = o; o.x = 5; alias.y = "z"; console.log(alias.x, o.y, alias === o, take(o));',
 'd02_in_a_weak_map':'const w = new WeakMap<object, number>();\nconst o = { ...f(1), x: 1 } satisfies P; w.set(o, 1);\nfunction again(p: P): number | undefined { return w.get(p) }\nconsole.log(again(o), take(o), w.has(o));',
 'd03_twice_through_a_function':'function make(i: number) { return { ...f(i), x: i } satisfies P }\nconst a = make(1), b = make(2); console.log(a !== b, take(a), take(b), a.x, b.x);',
 'd04_nested':'const o = { ...f(1), x: 1, inner: { ...f(2), x: 2 } satisfies P } satisfies P;\nconst i = o.inner; console.log(i === o.inner, take(o), take(o.inner), take(i));',
 'd05_in_an_array':'const l = [{ ...f(1), x: 1 } satisfies P, { ...f(2), x: 2 } satisfies P];\nconsole.log(l[0] !== l[1], take(l[0]!), take(l[1]!), l.indexOf(l[1]!));',
 'd06_as_an_argument':'console.log(take({ ...f(1), x: 1 } satisfies P), take({ ...f(2), x: 2 } as P));',
 'd07_frozen_at_once':'const o = Object.freeze({ ...f(1), x: 1 } satisfies P);\nconsole.log(Object.isFrozen(o), take(o)); let t = "no"; try { (o as P).x = 2 } catch (e) { t = words(e) } console.log(t, o.x);',
 'd08_returned_and_compared':'let last: P | undefined;\nfunction make(): P { const o = { ...f(1), x: 1 } satisfies P; last = o; return o }\nconst r = make(); console.log(r === last, take(r)); r.x = 8; console.log(last!.x);',
 'd09_under_a_try':'let o: P | undefined; try { o = { ...f(1), x: 1 } satisfies P } catch (e) { console.log(words(e)) }\nconsole.log(take(o!), Object.keys(o!).length);',
 'd10_keys_in_their_order':'const o = { y: "first", ...f(1), x: 1, o3: 33 } satisfies P;\nconsole.log(Object.keys(o).slice(0, 6).join(), Object.keys(o).slice(-3).join(), o.o3, JSON.stringify(o).length);',
 'd11_a_symbol_and_an_index_in_it':'const s = Symbol("s"); const extra = { [s]: 1, 7: "seven" };\nconst o = { ...f(1), ...extra, x: 1 } satisfies P;\nconsole.log(Reflect.ownKeys(o).length, (o as any)[s], (o as any)[7], Object.keys(o)[0], take(o));',
 'd12_more_than_the_type_names':'const more = { extra: 1, other: "o" };\nconst o = { ...f(1), ...more, x: 1 } satisfies P;\nconsole.log((o as any).extra, (o as any).other, Object.keys(o).length, take(o));',
 'z01_LANDED_a_declared_place_is_refused':'const made: P = { ...f(1), x: 1 };\nconsole.log(take(made));',
 'b05_held_by_a_declared_variable_first':'let tmp: P | undefined;\nfunction keep(p: P): P { tmp = p; return p }\nconst o = keep({ ...f(1), x: 1 } satisfies P) satisfies P;\nconsole.log(tmp === o, take(o)); tmp!.x = 7; console.log(o.x);',
 'b06_a_call_inside':'const held: object[] = [];\nfunction note<T extends object>(t: T): T { held.push(t); return t }\nconst o = note({ ...f(1), x: 1 }) satisfies P;\nconsole.log(held[0] === o, take(o)); (held[0] as P).x = 7; console.log(o.x);',
 'c07_super_in_a_method_of_an_argument':'function id(p: P): P { return p }\nconst o = id({ ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } });\nconsole.log(o.m!(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m!());',
 'c08_super_in_a_method_under_as':'const o = { ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } } as P;\nconsole.log(o.m!(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m!());',
 'c09_super_in_a_getter':'const o = { ...f(1), x: 1, get g() { return super.toString === Object.prototype.toString ? 1 : 0 } } satisfies P;\nconsole.log(o.g, take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.g);',
 'c10_super_stores':'const o = { ...f(1), x: 1, m() { super.y = "stored"; return 1 } } satisfies P;\no.m(); console.log((o as P).y, Object.keys(o).includes("y"), take(o));',
 'z02_LANDED_internal_error_a_name_under_three':'const made: P = { ...f(1), x: 1 };\nconst o = made satisfies P; const q = made as P; const r = made!;\nconsole.log(o === made, q === made, r === made, take(o)); made.x = 9; console.log(o.x, q.x, r.x);',
 'z03_LANDED_internal_error_an_assignment_inside':'let tmp: P | undefined;\nconst o = (tmp = { ...f(1), x: 1 }) satisfies P;\nconsole.log(tmp === o, take(o)); tmp!.x = 7; console.log(o.x, take(o));',
 'c11_super_in_a_method_inferred_const':'const o = { ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } };\nconsole.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c12_super_in_a_method_returned':'function make() { return { ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } } }\nconst o = make(); console.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c13_super_in_a_method_in_a_promise':'const o = await Promise.resolve(1).then(() => ({ ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } }));\nconsole.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c14_super_in_an_arrow_in_a_method':'const o = { ...f(1), x: 1, m() { return (() => super.toString === Object.prototype.toString)() } } satisfies P;\nconsole.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c15_the_outer_super_in_an_arrow_of_the_literal':'class B { hello() { return "B" } } class K extends B { make() { return { ...f(1), x: 1, m: () => super.hello() } satisfies P } }\nconst o = new K().make(); console.log(o.m(), take(o), Object.keys(o).length);',
 'c16_super_without_a_spread':'const o = { timeout: 1, x: 1, m() { return super.toString === Object.prototype.toString } } satisfies P;\nconsole.log(o.m(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m());',
 'c17_super_declared_place':'const o: P = { ...f(1), x: 1, m() { return super.toString === Object.prototype.toString } };\nconsole.log(o.m!(), take(o)); Object.setPrototypeOf(o, { toString: 1 }); console.log(o.m!());',
 'e01_a_property_read_under_non_null':'const h: { p?: P } = { p: { ...f(1), x: 1 } satisfies P };\nconst a = h.p!; const b = h.p satisfies P | undefined; const c = (cond(), h.p); const d = h.p ?? undefined; const e = cond() ? h.p : undefined;\nfunction cond(): boolean { return config.timeout === 5 }\nconsole.log(a === h.p, b === h.p, c === h.p, d === h.p, e === h.p, take(a));',
 'e02_parsed_data_under_each':'const data = JSON.parse(\'{"p":{"timeout":3,"x":4}}\');\nconst a = data.p!; const b = data.p satisfies unknown; const c = (String(1), data.p); const d = data.p ?? null; let z; const e = (z = data.p);\nconsole.log(a.x, b.x, c.x, d.x, e.x, z.x, take(a as P));',
}
for name,body in rows.items(): open(os.path.join(H,name+'.ts'),'w').write(HEAD+body+'\nconsole.log(config.timeout);\n')
print(len(rows),'rows')
