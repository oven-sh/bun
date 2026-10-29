#!/usr/bin/env python3
"""prototypes-and-methods-from-any.py <folder>: The ways out (o*): how a prototype, or a method, is got out of `any`; the way in is `const x: any = new A()`. The ways in (i*): how an instance comes to be reachable through `any`; the way out is Object.create(Object.getPrototypeOf(x))."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''interface Step { by: number }
class A { a = 1; plus(s: Step): number { this.a = this.a + s.by; return this.a; } }
const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name + ": " + (x as Error).message; } console.log(what + ": " + said); };
for (let i = 0; i < 100; i++) new A().plus({ by: i });
'''
OUT = {
'o01_getPrototypeOf': 'const s = Object.create(Object.getPrototypeOf(x)); s.a = 5; return s.plus({ by: 2 });',
'o02_constructor_prototype_into_create': 'const s = Object.create(x.constructor.prototype); s.a = 5; return s.plus({ by: 2 });',
'o03_dunder_proto_into_create': 'const s = Object.create(x.__proto__); s.a = 5; return s.plus({ by: 2 });',
'o04_a_literal_with_dunder_proto': 'const s: any = { __proto__: x.constructor.prototype, a: 5 }; return s.plus({ by: 2 });',
'o05_the_instance_as_the_prototype': 'const s = Object.create(x); s.a = 5; return s.plus({ by: 2 }) + " " + x.a;',
'o06_a_class_extends_its_constructor': 'const K: any = x.constructor; class B extends K {} const s: any = new B(); return s.plus({ by: 2 });',
'o07_the_method_called_on_another': 'return x.plus.call({ a: 5 }, { by: 2 });',
'o08_the_method_applied': 'return x.plus.apply({ a: 5 }, [{ by: 2 }]);',
'o09_the_method_bound': 'const f = x.plus.bind({ a: 5 }); return f({ by: 2 });',
'o10_the_method_put_on_another': 'const s: any = { a: 5 }; s.plus = x.plus; return s.plus({ by: 2 });',
'o11_setPrototypeOf': 'const s: any = Object.setPrototypeOf({ a: 5 }, x.constructor.prototype); return s.plus({ by: 2 });',
'o12_dunder_proto_is_assigned': 'const s: any = { a: 5 }; s.__proto__ = x.__proto__; return s.plus({ by: 2 });',
'o13_a_function_is_given_the_prototype': 'const F: any = function (this: any) { this.a = 5; }; F.prototype = x.constructor.prototype; const s = new F(); return s.plus({ by: 2 });',
'o14_Reflect_construct_for_it': 'const s: any = Reflect.construct(Object, [], x.constructor); s.a = 5; return s.plus({ by: 2 });',
'o15_Reflect_apply': 'return Reflect.apply(x.plus, { a: 5 }, [{ by: 2 }]);',
'o16_the_method_by_key': 'const k: string = "pl" + "us"; const s: any = { a: 5 }; s.m = x[k]; return s.m({ by: 2 });',
'o17_new_its_constructor': 'const s = new x.constructor(); return s.plus({ by: 2 });',
}
WAY = 'const s = Object.create(Object.getPrototypeOf(x)); s.a = 5; return s.plus({ by: 2 });'
IN = {
'i01_an_annotated_const': ('', 'const x: any = new A();'),
'i02_pushed_into_an_array_of_any': ('', 'const kept: any[] = []; kept.push(new A()); const x = kept[0];'),
'i03_an_argument': ('function id(v: any): any { return v; }', 'const x = id(new A());'),
'i04_a_result': ('function get(): any { return new A(); }', 'const x = get();'),
'i05_as_any_in_a_const': ('', 'const x = new A() as any;'),
'i06_in_a_literal_that_enters_any': ('', 'const o: any = { a: new A() }; const x = o.a;'),
'i07_in_an_array_literal_that_enters_any': ('', 'const o: any = [new A()]; const x = o[0];'),
'i08_an_array_of_them_cast': ('', 'const list = [new A()]; const x = (list as any[])[0];'),
'i09_an_array_of_them_enters_any': ('', 'const list: A[] = [new A()]; const o: any = list; const x = o[0];'),
'i10_a_holder_enters_any': ('interface Holder { it: A }', 'const h: Holder = { it: new A() }; const o: any = h; const x = o.it;'),
'i11_a_callback_takes_any': ('', 'let x: any; [new A()].forEach((v: any) => { x = v; });'),
'i12_a_Map_of_any': ('', 'const m = new Map<string, any>(); m.set("k", new A()); const x = m.get("k");'),
'i13_thrown_and_caught': ('', 'let x: any; try { throw new A(); } catch (v) { x = v; }'),
'i14_this_is_returned_as_any': ('class A2 extends A { self(): any { return this; } }', 'const x = new A2().self();'),
'i15_unknown_then_any': ('', 'const u: unknown = new A(); const x = u as any;'),
'i16_object': ('', 'const u: object = new A(); const x: any = u;'),
'i17_a_loop_over_any': ('', 'const list: A[] = [new A()]; let x: any; for (const v of list as any) { x = v; }'),
'i18_a_pattern_with_any': ('', 'const { it: x }: any = { it: new A() };'),
'i19_a_generic_identity': ('function same<V>(v: V): V { return v; }', 'const x: any = same(new A());'),
'i20_a_field_typed_any': ('class Box { v: any = null; }', 'const b = new Box(); b.v = new A(); const x = b.v;'),
'i21_spread_of_a_holder': ('interface Holder { it: A }', 'const h: Holder = { it: new A() }; const o: any = { ...h }; const x = o.it;'),
'i22_a_promise': ('', 'void Promise.resolve(new A()).then((v: any) => { const s = Object.create(Object.getPrototypeOf(v)); s.a = 5; console.log("later: " + s.plus({ by: 2 })); }).catch((e: any) => console.log("later: THROWS " + e.message)); return "asked";'),
'i23_a_function_typed_to_yield_any': ('', 'const f: () => any = () => new A(); const x = f();'),
'i24_a_method_typed_to_yield_any': ('interface Src { get(): any }', 'const s: Src = { get() { return new A(); } }; const x = s.get();'),
'i25_a_generic_class_of_the_program_at_any': ('class Cell<X> { v: X; constructor(v: X) { this.v = v; } }', 'const c: Cell<any> = new Cell(new A()); const x = c.v;'),
'i26_a_promise_of_any': ('', 'const p: Promise<any> = Promise.resolve(new A()); void p.then((v) => { const s = Object.create(Object.getPrototypeOf(v)); s.a = 5; console.log("later: " + s.plus({ by: 2 })); }).catch((e: any) => console.log("later: THROWS " + e.message)); return "asked";'),
'i27_cast_in_a_callback': ('', 'const x = [new A()].map((v) => v as any)[0];'),
'i28_Reflect_get_of_a_holder': ('interface Holder { it: A }', 'const h: Holder = { it: new A() }; const x = Reflect.get(h, "it");'),
'i29_a_holder_cast': ('interface Holder { it: A }', 'const h: Holder = { it: new A() }; const x = (h as any).it;'),
'i30_kept_on_the_global_object': ('', '(globalThis as any).keep = new A(); const x = (globalThis as any).keep;'),
'i31_by_way_of_an_interface': ('interface HasPlus { plus(s: Step): number }', 'const h: HasPlus = new A(); const x: any = h;'),
'i32_a_union_of_functions_takes_any': ('', 'let x: any; const f: ((v: any) => void) | ((v: any, w: number) => void) = (v: any) => { x = v; }; [new A()].forEach(f);'),
'i33_a_setter_typed_any': ('class Sink { got: any = null; set it(v: any) { this.got = v; } }', 'const k = new Sink(); k.it = new A(); const x = k.got;'),
'i34_a_rest_of_any': ('function last(...all: any[]): any { return all[all.length - 1]; }', 'const x = last(1, new A());'),
'i35_a_default_of_a_pattern': ('', 'const { it: x = new A() }: { it?: any } = {};'),
'i36_a_conditional_into_any': ('', 'const c: boolean = Date.now() > 0; const x: any = c ? new A() : null;'),
'i37_this_enters_an_interface': ('interface HasPlus { plus(s: Step): number }\nclass A3 extends A { me(): HasPlus { return this; } }', 'const h = new A3().me(); const x: any = h;'),
'i38_from_one_interface_to_another': ('interface HasPlus { plus(s: Step): number }\ninterface HasMore { plus(s: Step): number; a: number }', 'const g: HasMore = new A(); const h: HasPlus = g; const x: any = h;'),
'i39_an_interface_as_a_parameter_handed_on': ('interface HasPlus { plus(s: Step): number }\nfunction outer(h: HasPlus): any { return inner(h); }\nfunction inner(h: HasPlus): any { return h; }', 'const x = outer(new A());'),
'i40_a_generic_interface': ('interface Has<V> { plus(s: V): number }', 'const h: Has<Step> = new A(); const x: any = h;'),
'i41_an_array_of_the_interface': ('interface HasPlus { plus(s: Step): number }', 'const list: HasPlus[] = [new A()]; const o: any = list; const x = o[0];'),
}
for k, b in OUT.items():
    open(k + '.ts', 'w').write(HEAD + 'say("%s", () => { const x: any = new A(); %s });\nexport {}\n' % (k[:3], b))
for k, (top, b) in IN.items():
    body = b if 'return ' in b else b + ' ' + WAY
    open(k + '.ts', 'w').write(HEAD + top + '\nsay("%s", () => { %s });\nexport {}\n' % (k[:3], body))
print(len(OUT), len(IN))
