// Every syntactic position a call can be in: the stack trace taken inside the callee shows whether the caller gave up its frame, as in plain Bun. A cast is no call and no test: `return probe() as unknown as number` is a tail call like `return probe()`.
declare const console: any;
let seen: string = "";
function frames(): string { return String(new Error("x").stack).split("\n").filter(l => /t_[a-zA-Z0-9_]+/.test(l)).map(l => /(t_[a-zA-Z0-9_]+)/.exec(l)![1]).join(" "); }
function framesOf(e: any): string { return String(e.stack).split("\n").filter((l: string) => /t_[a-zA-Z0-9_]+/.test(l)).map((l: string) => /(t_[a-zA-Z0-9_]+)/.exec(l)![1]).join(" "); }
function probe(): string { seen = frames(); return seen; }
function probeObject(): any { seen = frames(); return { seen }; }
function other(): string { return "other"; }
function row(name: string, f: () => any) { seen = "-"; try { f(); } catch (e: any) { seen = "threw " + e.constructor.name; } console.log(name + ": [" + seen + "]"); }
const yes: boolean = Date.now() > 0, no: boolean = !yes;
const nil: any = yes ? undefined : "x";
function t_return(): string { return probe(); }
row("return", () => { const s: any = t_return(); return s; });
const t_arrow = (): string => probe();
row("arrow", () => { const s: any = t_arrow(); return s; });
const t_arrow_block = (): string => { return probe(); };
row("arrow_block", () => { const s: any = t_arrow_block(); return s; });
const t_function_expression = function (): string { return probe(); };
row("function_expression", () => { const s: any = t_function_expression(); return s; });
function t_paren(): string { return (probe()); }
row("paren", () => { const s: any = t_paren(); return s; });
function t_paren2(): string { return ((probe())); }
row("paren2", () => { const s: any = t_paren2(); return s; });
function t_cond_yes(): string { return yes ? probe() : other(); }
row("cond_yes", () => { const s: any = t_cond_yes(); return s; });
function t_cond_no(): string { return no ? other() : probe(); }
row("cond_no", () => { const s: any = t_cond_no(); return s; });
function t_cond_const(): string { return yes ? probe() : "k"; }
row("cond_const", () => { const s: any = t_cond_const(); return s; });
function t_cond_test(): string { return probe() ? "a" : "b"; }
row("cond_test", () => { const s: any = t_cond_test(); return s; });
function t_cond_nested(): string { return yes ? (no ? other() : probe()) : other(); }
row("cond_nested", () => { const s: any = t_cond_nested(); return s; });
function t_and_right(): any { return yes && probe(); }
row("and_right", () => { const s: any = t_and_right(); return s; });
function t_and_left(): any { return probe() && no; }
row("and_left", () => { const s: any = t_and_left(); return s; });
function t_or_right(): any { return no || probe(); }
row("or_right", () => { const s: any = t_or_right(); return s; });
function t_or_left(): any { return probe() || no; }
row("or_left", () => { const s: any = t_or_left(); return s; });
function t_nullish_right(): any { return nil ?? probe(); }
row("nullish_right", () => { const s: any = t_nullish_right(); return s; });
function t_nullish_left(): any { return probe() ?? nil; }
row("nullish_left", () => { const s: any = t_nullish_left(); return s; });
function t_comma_last(): string { return other(), probe(); }
row("comma_last", () => { const s: any = t_comma_last(); return s; });
function t_comma_first(): string { return probe(), other(); }
row("comma_first", () => { const s: any = t_comma_first(); return s; });
function t_mixed(): any { return yes ? (yes && (other(), probe())) : (no || other()); }
row("mixed", () => { const s: any = t_mixed(); return s; });
const t_arrow_cond = (): string => (yes ? probe() : other());
row("arrow_cond", () => { const s: any = t_arrow_cond(); return s; });
const t_arrow_and = (): any => yes && probe();
row("arrow_and", () => { const s: any = t_arrow_and(); return s; });
function t_var_then_return(): string { var e; e = probe(); return e; }
row("var_then_return", () => { const s: any = t_var_then_return(); return s; });
function t_let_then_return(): string { let e: string; e = probe(); return e; }
row("let_then_return", () => { const s: any = t_let_then_return(); return s; });
function t_assign(): string { let e: string; return e = probe(); }
row("assign", () => { const s: any = t_assign(); return s; });
function t_plus(): string { return probe() + ""; }
row("plus", () => { const s: any = t_plus(); return s; });
function t_not(): boolean { return !probe(); }
row("not", () => { const s: any = t_not(); return s; });
function t_void(): any { return void probe(); }
row("void", () => { const s: any = t_void(); return s; });
function t_typeof(): string { return typeof probe(); }
row("typeof", () => { const s: any = t_typeof(); return s; });
function t_element(): string { return [probe(), other()][0]; }
row("element", () => { const s: any = t_element(); return s; });
function t_member(): any { return probe().length; }
row("member", () => { const s: any = t_member(); return s; });
function t_argument(): string { return String(probe()); }
row("argument", () => { const s: any = t_argument(); return s; });
function t_template(): string { return `${probe()}`; }
row("template", () => { const s: any = t_template(); return s; });
function t_statement() { probe(); }
row("statement", () => { const s: any = t_statement(); return s; });
function t_statement_then_return() { probe(); return; }
row("statement_then_return", () => { const s: any = t_statement_then_return(); return s; });
class t_K0 { constructor() { probe(); } }
function t_new(): any { return new t_K0(); }
row("new", () => { const s: any = t_new(); return s; });
function t_spread_in_array(): any { return [...probe()]; }
row("spread_in_array", () => { const s: any = t_spread_in_array(); return s; });
function t_object(): any { return { a: probe() }; }
row("object", () => { const s: any = t_object(); return s; });
function t_if(): string { if (yes) return probe(); return other(); }
row("if", () => { const s: any = t_if(); return s; });
function t_else(): string { if (no) return other(); else return probe(); }
row("else", () => { const s: any = t_else(); return s; });
function t_block(): string { { { return probe(); } } }
row("block", () => { const s: any = t_block(); return s; });
function t_labelled(): string { a: { if (no) break a; return probe(); } return other(); }
row("labelled", () => { const s: any = t_labelled(); return s; });
function t_while(): string { while (yes) { return probe(); } return other(); }
row("while", () => { const s: any = t_while(); return s; });
function t_do(): string { do { return probe(); } while (yes); }
row("do", () => { const s: any = t_do(); return s; });
function t_for(): string { for (let i = 0; i < 1; i++) { return probe(); } return other(); }
row("for", () => { const s: any = t_for(); return s; });
function t_for_closure(): string { for (let i = 0; i < 1; i++) { const g = () => i; if (g() === 0) return probe(); } return other(); }
row("for_closure", () => { const s: any = t_for_closure(); return s; });
function t_for_in(): string { for (const k in { a: 1 }) { return probe(); } return other(); }
row("for_in", () => { const s: any = t_for_in(); return s; });
function t_for_of(): string { for (const k of [1]) { return probe(); } return other(); }
row("for_of", () => { const s: any = t_for_of(); return s; });
function t_for_of_set(): string { for (const k of new Set([1])) { return probe(); } return other(); }
row("for_of_set", () => { const s: any = t_for_of_set(); return s; });
function t_for_of_string(): string { for (const k of "a") { return probe(); } return other(); }
row("for_of_string", () => { const s: any = t_for_of_string(); return s; });
function t_after_for_of(): string { for (const k of [1]) { other(); } return probe(); }
row("after_for_of", () => { const s: any = t_after_for_of(); return s; });
function t_after_for_in(): string { for (const k in { a: 1 }) { other(); } return probe(); }
row("after_for_in", () => { const s: any = t_after_for_in(); return s; });
function t_while_in_for_of(): string { for (const k of [1]) { while (yes) { return probe(); } } return other(); }
row("while_in_for_of", () => { const s: any = t_while_in_for_of(); return s; });
function t_for_of_in_while(): string { while (yes) { for (const k of [1]) { other(); } return probe(); } return other(); }
row("for_of_in_while", () => { const s: any = t_for_of_in_while(); return s; });
function t_switch(): string { switch (yes) { case true: return probe(); default: return other(); } }
row("switch", () => { const s: any = t_switch(); return s; });
function t_switch_default(): string { switch (yes) { case false: return other(); default: return probe(); } }
row("switch_default", () => { const s: any = t_switch_default(); return s; });
function t_switch_in_for_of(): string { for (const k of [1]) { switch (k) { case 1: return probe(); } } return other(); }
row("switch_in_for_of", () => { const s: any = t_switch_in_for_of(); return s; });
function t_try(): string { try { return probe(); } catch { return other(); } }
row("try", () => { const s: any = t_try(); return s; });
function t_try_rethrow(): string { try { return probe(); } catch (e) { throw e; } }
row("try_rethrow", () => { const s: any = t_try_rethrow(); return s; });
function t_try_finally(): string { try { return probe(); } finally { other(); } }
row("try_finally", () => { const s: any = t_try_finally(); return s; });
function t_try_empty_finally(): string { try { return probe(); } finally { } }
row("try_empty_finally", () => { const s: any = t_try_empty_finally(); return s; });
function t_catch(): string { try { throw 1; } catch { return probe(); } }
row("catch", () => { const s: any = t_catch(); return s; });
function t_catch_param(): string { try { throw 1; } catch (e) { return probe(); } }
row("catch_param", () => { const s: any = t_catch_param(); return s; });
function t_catch_with_finally(): string { try { throw 1; } catch { return probe(); } finally { other(); } }
row("catch_with_finally", () => { const s: any = t_catch_with_finally(); return s; });
function t_finally(): string { try { other(); } finally { return probe(); } }
row("finally", () => { const s: any = t_finally(); return s; });
function t_finally_after_catch(): string { try { throw 1; } catch { other(); } finally { return probe(); } }
row("finally_after_catch", () => { const s: any = t_finally_after_catch(); return s; });
function t_after_try(): string { try { other(); } catch { } return probe(); }
row("after_try", () => { const s: any = t_after_try(); return s; });
function t_after_try_finally(): string { try { other(); } finally { other(); } return probe(); }
row("after_try_finally", () => { const s: any = t_after_try_finally(); return s; });
function t_catch_in_try(): string { try { try { throw 1; } catch { return probe(); } } catch { return other(); } }
row("catch_in_try", () => { const s: any = t_catch_in_try(); return s; });
function t_finally_in_try(): string { try { try { other(); } finally { return probe(); } } catch { return other(); } }
row("finally_in_try", () => { const s: any = t_finally_in_try(); return s; });
function t_catch_in_catch(): string { try { throw 1; } catch { try { throw 2; } catch { return probe(); } } }
row("catch_in_catch", () => { const s: any = t_catch_in_catch(); return s; });
function t_catch_in_finally(): string { try { other(); } finally { try { throw 2; } catch { return probe(); } } }
row("catch_in_finally", () => { const s: any = t_catch_in_finally(); return s; });
function t_if_in_try(): string { try { if (yes) { return probe(); } } catch { } return other(); }
row("if_in_try", () => { const s: any = t_if_in_try(); return s; });
function t_closure_in_try(): string { try { const t_inner = (): string => probe(); var s; s = t_inner(); return s; } catch { return other(); } }
row("closure_in_try", () => { const s: any = t_closure_in_try(); return s; });
function t_while_in_catch(): string { try { throw 1; } catch { while (yes) { return probe(); } } return other(); }
row("while_in_catch", () => { const s: any = t_while_in_catch(); return s; });
class K1 { t_method(): string { return probe(); } }
row("method", () => { const s: any = new K1().t_method(); return s; });
class K2 { static t_static_method(): string { return probe(); } }
row("static_method", () => { const s: any = K2.t_static_method(); return s; });
class K3 { get t_getter(): string { return probe(); } }
row("getter", () => { const s: any = new K3().t_getter; return s; });
class K4 { set t_setter(v: string) { probe(); } }
row("setter", () => { const s: any = new K4().t_setter = "a"; return s; });
class K5 { #t_private_method(): string { return probe(); } t_outer(): string { var s; s = this.#t_private_method(); return s; } }
row("private_method", () => { const s: any = new K5().t_outer(); return s; });
class K6 { t_field_arrow = (): string => probe(); }
row("field_arrow", () => { const s: any = new K6().t_field_arrow(); return s; });
const o1 = { t_object_method(): string { return probe(); } };
row("object_method", () => { const s: any = o1.t_object_method(); return s; });
const o2 = { get t_object_getter(): string { return probe(); } };
row("object_getter", () => { const s: any = o2.t_object_getter; return s; });
const o3 = { t_object_arrow: (): string => probe() };
row("object_arrow", () => { const s: any = o3.t_object_arrow(); return s; });
function t_function_called(): any { return probeObject(); }
row("function_called", () => { const s: any = t_function_called(); return s; });
async function t_async() { return probe(); }
row("async", () => { const s: any = t_async(); return s; });
const t_async_arrow = async () => probe();
row("async_arrow", () => { const s: any = t_async_arrow(); return s; });
function* t_generator() { return probe(); }
row("generator", () => { const s: any = t_generator().next(); return s; });
async function* t_async_generator() { return probe(); }
row("async_generator", () => { const s: any = t_async_generator().next(); return s; });
class K7 { async t_async_method() { return probe(); } }
row("async_method", () => { const s: any = new K7().t_async_method(); return s; });
function t_nested(): string { function t_nested_inner(): string { return probe(); } return t_nested_inner(); }
row("nested", () => { const s: any = t_nested(); return s; });
function t_nested_kept(): string { function t_nested_inner2(): string { return probe(); } var s; s = t_nested_inner2(); return s; }
row("nested_kept", () => { const s: any = t_nested_kept(); return s; });
function t_iife(): string { return (() => probe())(); }
row("iife", () => { const s: any = t_iife(); return s; });
function t_default_parameter(a: string = probe()): string { return a; }
row("default_parameter", () => { const s: any = t_default_parameter(); return s; });
function t_by_value(f: () => string): string { return f(); }
row("by_value", () => { const s: any = t_by_value(probe); return s; });
function t_by_value_any(f: any): any { return f(); }
row("by_value_any", () => { const s: any = t_by_value_any(probe); return s; });
function t_by_value_any_held(f: any): string { return f(); }
row("by_value_any_held", () => { const s: any = t_by_value_any_held(probe); return s; });
const o4 = { m: probe };
function t_by_name(): string { return o4.m(); }
row("by_name", () => { const s: any = t_by_name(); return s; });
const o5: any = { m: probe };
function t_by_key(k: string): string { return o5[k](); }
row("by_key", () => { const s: any = t_by_key("m"); return s; });
function t_optional_call(f: any): any { return f?.(); }
row("optional_call", () => { const s: any = t_optional_call(probe); return s; });
function t_optional_member(o: any): any { return o?.m(); }
row("optional_member", () => { const s: any = t_optional_member(o4); return s; });
function t_optional_method(o: any): any { return o.m?.(); }
row("optional_method", () => { const s: any = t_optional_method(o4); return s; });
function t_optional_long(o: any): any { return o?.a?.b.m(); }
row("optional_long", () => { const s: any = t_optional_long({ a: { b: o4 } }); return s; });
function t_optional_inner(o: any): any { return o?.m().length; }
row("optional_inner", () => { const s: any = t_optional_inner(o4); return s; });
function t_optional_paren(o: any): any { return (o?.m)(); }
row("optional_paren", () => { const s: any = t_optional_paren(o4); return s; });
function tag(s: any): string { return probe(); }
function t_tagged(): string { return tag`x`; }
row("tagged", () => { const s: any = t_tagged(); return s; });
const o6 = { tag(s: any): string { return probe(); } };
function t_tagged_member(): string { return o6.tag`x`; }
row("tagged_member", () => { const s: any = t_tagged_member(); return s; });
function t_call(): string { return probe.call(undefined); }
row("call", () => { const s: any = t_call(); return s; });
function t_apply(): string { return probe.apply(undefined, []); }
row("apply", () => { const s: any = t_apply(); return s; });
function t_apply_arguments(): any { return probe.apply(undefined, arguments as any); }
row("apply_arguments", () => { const s: any = t_apply_arguments(); return s; });
const none: [] = [];
function t_spread(): string { return probe(...none); }
row("spread", () => { const s: any = t_spread(); return s; });
function t_spread_method(): string { return o4.m(...none); }
row("spread_method", () => { const s: any = t_spread_method(); return s; });
function t_reflect_apply(): any { return Reflect.apply(probe, undefined, []); }
row("reflect_apply", () => { const s: any = t_reflect_apply(); return s; });
const bound = probe.bind(undefined);
function t_bound(): string { return bound(); }
row("bound", () => { const s: any = t_bound(); return s; });
function t_comma_callee(): string { return (0, o4.m)(); }
row("comma_callee", () => { const s: any = t_comma_callee(); return s; });
function maker(): () => string { return probe; }
function t_call_of_call(): string { return maker()(); }
row("call_of_call", () => { const s: any = t_call_of_call(); return s; });
function t_maker(): () => string { probe(); return other; }
function t_call_of_call_inner(): string { return t_maker()(); }
row("call_of_call_inner", () => { const s: any = t_call_of_call_inner(); return s; });
class B1 { m(): string { return probe(); } }
class D1 extends B1 { t_super_method(): string { return super.m(); } }
row("super_method", () => { const s: any = new D1().t_super_method(); return s; });
class K8 { m(): string { return probe(); } t_this_method(): string { return this.m(); } }
row("this_method", () => { const s: any = new K8().t_this_method(); return s; });
class K9 { static m(): string { return probe(); } static t_static_this(): string { return this.m(); } }
row("static_this", () => { const s: any = K9.t_static_this(); return s; });
function t_callback(): any { return [1].map(() => probe()); }
row("callback", () => { const s: any = t_callback(); return s; });
function t_callback_named(): any { return [1].map(function t_cb() { return probe(); }); }
row("callback_named", () => { const s: any = t_callback_named(); return s; });
const o7 = { get g(): string { return probe(); } };
function t_getter_read(): string { return o7.g; }
row("getter_read", () => { const s: any = t_getter_read(); return s; });
const px: any = new Proxy(probe, {});
function t_proxy(): any { return px(); }
row("proxy", () => { const s: any = t_proxy(); return s; });
const px2: any = new Proxy(other, { apply() { return probe(); } });
function t_proxy_trap(): any { return px2(); }
row("proxy_trap", () => { const s: any = t_proxy_trap(); return s; });
function t_builtin_throws(): any { return JSON.parse("{"); }
function t_reads_trace(): any { try { var s; s = t_builtin_throws(); return s; } catch (e: any) { seen = String(e.stack).split("\n").filter((l: string) => /t_[a-z_]+/.test(l)).map((l: string) => /(t_[a-z_]+)/.exec(l)![1]).join(" "); } }
row("builtin_throws", () => { const s: any = t_reads_trace(); return s; });
const stringy = { toString(): string { return probe(); } };
function t_builtin_to_string(): string { return String(stringy); }
row("builtin_to_string", () => { const s: any = t_builtin_to_string(); return s; });
function t_builtin_sort(): any { return [2, 1].sort((a, b) => (probe(), a - b)); }
row("builtin_sort", () => { const s: any = t_builtin_sort(); return s; });
function t_builtin_replace(): string { return "a".replace(/a/, () => probe()); }
row("builtin_replace", () => { const s: any = t_builtin_replace(); return s; });
function t_builtin_for_each(): any { return [1].forEach(() => { probe(); }); }
row("builtin_for_each", () => { const s: any = t_builtin_for_each(); return s; });
function t_builtin_filter(): any { return [1].filter(() => probe()); }
row("builtin_filter", () => { const s: any = t_builtin_filter(); return s; });
function t_builtin_reduce(): any { return [1, 2].reduce((a, b) => (probe(), a + b)); }
row("builtin_reduce", () => { const s: any = t_builtin_reduce(); return s; });
function t_builtin_from(): any { return Array.from([1], () => probe()); }
row("builtin_from", () => { const s: any = t_builtin_from(); return s; });
const px3: any = new Proxy({}, { ownKeys() { probe(); return []; } });
function t_builtin_keys_of_proxy(): any { return Object.keys(px3); }
row("builtin_keys_of_proxy", () => { const s: any = t_builtin_keys_of_proxy(); return s; });
function t_builtin_map_for_each(): any { return new Map([[1, 1]]).forEach(() => { probe(); }); }
row("builtin_map_for_each", () => { const s: any = t_builtin_map_for_each(); return s; });
function t_builtin_stringify(): any { return JSON.stringify({ toJSON() { return probe(); } }); }
row("builtin_stringify", () => { const s: any = t_builtin_stringify(); return s; });
const numbery = { valueOf() { probe(); return 1; } };
function t_builtin_number(): any { return Number(numbery); }
row("builtin_number", () => { const s: any = t_builtin_number(); return s; });
function t_builtin_math(): any { return Math.max(numbery as any, 2); }
row("builtin_math", () => { const s: any = t_builtin_math(); return s; });
function t_not_a_function(f: any): any { return f(); }
row("not_a_function", () => { try { t_not_a_function(undefined); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_not_a_function_number(f: any): any { return f(1, 2); }
row("not_a_function_number", () => { try { t_not_a_function_number(5); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_not_a_function_object(f: any): any { return f(); }
row("not_a_function_object", () => { try { t_not_a_function_object({}); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_no_such_method(o: any): any { return o.nothing(); }
row("no_such_method", () => { try { t_no_such_method({}); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_method_of_null(o: any): any { return o.nothing(); }
row("method_of_null", () => { try { t_method_of_null(null); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_method_is_a_number(o: any): any { return o.k(1); }
row("method_is_a_number", () => { try { t_method_is_a_number({ k: 1 }); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
class Klass { }
function t_class_called(f: any): any { return f(); }
row("class_called", () => { try { t_class_called(Klass); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
const o8 = { get m(): any { throw new Error("getter"); } };
function t_getter_throws(o: any): any { return o.m(); }
row("getter_throws", () => { try { t_getter_throws(o8); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_getter_throws_typed(o: any): number { return o.m(); }
row("getter_throws_typed", () => { try { t_getter_throws_typed(o8); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
const o9 = { get m(): any { probe(); return other; } };
function t_getter_probes_typed(o: any): string { return o.m(); }
row("getter_probes_typed", () => { const s: any = t_getter_probes_typed(o9); return s; });
const nextThrows = { [Symbol.iterator]() { return { next(): any { throw new Error("next"); } }; } };
function t_spread_next_throws(f: any, xs: any): any { return f(...xs); }
row("spread_next_throws", () => { try { t_spread_next_throws(other, nextThrows); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_spread_next_throws_typed(f: any, xs: any): string { return f(...xs); }
row("spread_next_throws_typed", () => { try { t_spread_next_throws_typed(other, nextThrows); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
const nextProbes = { [Symbol.iterator]() { return { next(): any { probe(); return { done: true }; } }; } };
function t_spread_next_probes_typed(f: any, xs: any): string { return f(...xs); }
row("spread_next_probes_typed", () => { const s: any = t_spread_next_probes_typed(other, nextProbes); return s; });
function t_spread_callee_probes_typed(f: any, xs: any): string { return f(...xs); }
row("spread_callee_probes_typed", () => { const s: any = t_spread_callee_probes_typed(probe, [] as any[]); return s; });
function t_thrower(): any { throw new Error("thrown"); }
function t_callee_throws(): any { return t_thrower(); }
row("callee_throws", () => { try { t_callee_throws(); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_callee_throws_by_value(f: any): any { return f(); }
row("callee_throws_by_value", () => { try { t_callee_throws_by_value(t_thrower); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_argument_throws(): any { return (other as any)(t_thrower()); }
row("argument_throws", () => { try { t_argument_throws(); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_apply_not_a_function(f: any): any { return f.apply(undefined, []); }
row("apply_not_a_function", () => { try { t_apply_not_a_function({}); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_tag_not_a_function(f: any): any { return f`x`; }
row("tag_not_a_function", () => { try { t_tag_not_a_function(undefined); } catch (e: any) { seen = e.constructor.name + " " + framesOf(e); } });
function t_captures(cut: any): string { const o: any = {}; (Error as any).captureStackTrace(o, cut); seen = framesOf(o); return seen; }
function t_capture(): string { return t_captures(undefined); }
row("capture", () => { const s: any = t_capture(); return s; });
function t_capture_cut_at_leaf(): string { return t_captures(t_captures); }
row("capture_cut_at_leaf", () => { const s: any = t_capture_cut_at_leaf(); return s; });
function t_gone(): string { return t_captures(t_gone); }
function t_capture_cut_at_gone(): string { var s; s = t_gone(); return s; }
row("capture_cut_at_gone", () => { const s: any = t_capture_cut_at_gone(); return s; });
function t_kept(): string { var s; s = t_captures(t_kept); return s; }
function t_capture_cut_at_kept(): string { var s; s = t_kept(); return s; }
row("capture_cut_at_kept", () => { const s: any = t_capture_cut_at_kept(); return s; });
function t_mid(cut: any): string { return t_captures(cut); }
function t_capture_through_tail(): string { var s; s = t_mid(t_capture_through_tail); return s; }
row("capture_through_tail", () => { const s: any = t_capture_through_tail(); return s; });
function t_capture_by_value(f: any): any { return f(undefined); }
row("capture_by_value", () => { const s: any = t_capture_by_value(t_captures); return s; });
function t_limit3(): string { const was = (Error as any).stackTraceLimit; (Error as any).stackTraceLimit = 2; seen = frames(); (Error as any).stackTraceLimit = was; return seen; }
function t_limit2(): string { return t_limit3(); }
function t_stack_limit(): string { var s; s = t_limit2(); return s; }
row("stack_limit", () => { const s: any = t_stack_limit(); return s; });
function t_c3(): string { return probe(); }
function t_c2(): string { return t_c3(); }
function t_chain3(): string { return t_c2(); }
row("chain3", () => { const s: any = t_chain3(); return s; });
function t_d3(): string { return probe(); }
function t_d2(): string { return t_d3(); }
function t_chain_kept_top(): string { var s; s = t_d2(); return s; }
row("chain_kept_top", () => { const s: any = t_chain_kept_top(); return s; });
function t_e3(): string { return probe(); }
function t_e2(): string { var s; s = t_e3(); return s; }
function t_chain_kept_middle(): string { return t_e2(); }
row("chain_kept_middle", () => { const s: any = t_chain_kept_middle(); return s; });
function t_f3(): string { var s; s = probe(); return s; }
function t_f2(): string { return t_f3(); }
function t_chain_kept_leaf(): string { return t_f2(); }
row("chain_kept_leaf", () => { const s: any = t_chain_kept_leaf(); return s; });
function t_g2(a: number, b: string, c: boolean): string { return c ? probe() : b + a; }
function t_with_arguments(a: number): string { return t_g2(a + 1, "x", yes); }
row("with_arguments", () => { const s: any = t_with_arguments(1); return s; });
function t_h2(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): string { return a + b + c + d + e + f + g + h + i + j + k + l > 0 ? probe() : other(); }
function t_many_arguments(a: number): string { return t_h2(a, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); }
row("many_arguments", () => { const s: any = t_many_arguments(1); return s; });
function t_i2(a?: number, b?: number): string { return probe(); }
function t_fewer_arguments(): string { return t_i2(); }
row("fewer_arguments", () => { const s: any = t_fewer_arguments(); return s; });
function t_j2(...a: number[]): string { return probe(); }
function t_rest(): string { return t_j2(1, 2, 3); }
row("rest", () => { const s: any = t_rest(); return s; });
function t_recursion(n: number): string { return n === 0 ? probe() : t_recursion(n - 1); }
row("recursion", () => { const s: any = t_recursion(5); return s; });
function t_recursion_kept(n: number): string { if (n === 0) return probe(); var s; s = t_recursion_kept(n - 1); return s; }
row("recursion_kept", () => { const s: any = t_recursion_kept(3); return s; });
function t_k2(): string { seen = frames(); throw new Error("thrown"); }
function t_throws(): string { return t_k2(); }
function t_catches(): string { try { return t_throws(); } catch (e) { return "caught"; } }
row("throws", () => { const s: any = t_catches(); return s; });
function t_as(): string { return probe() as string; }
row("as", () => { const s: any = t_as(); return s; });
function t_as_any(): any { return probe() as any; }
row("as_any", () => { const s: any = t_as_any(); return s; });
function t_as_unknown_as(): number { return probe() as unknown as number; }
row("as_unknown_as", () => { const s: any = t_as_unknown_as(); return s; });
function maybe(): string | undefined { return probe(); }
function t_non_null(): string { return maybe()!; }
row("non_null", () => { const s: any = t_non_null(); return s; });
function t_satisfies(): string { return probe() satisfies string; }
row("satisfies", () => { const s: any = t_satisfies(); return s; });
function t_angle(): string { return <string>probe(); }
row("angle", () => { const s: any = t_angle(); return s; });
function t_as_const() { return probe() as string as "a"; }
row("as_const", () => { const s: any = t_as_const(); return s; });
function t_as_in_cond(): string { return (yes ? probe() as string : other()) as string; }
row("as_in_cond", () => { const s: any = t_as_in_cond(); return s; });
function identity<T>(a: T): T { probe(); return a; }
function t_generic(): string { return identity<string>("a"); }
row("generic", () => { const s: any = t_generic(); return s; });
function t_back<T>(a: T): T { seen = frames(); return a; }
function t_generic_hands_back(): string { return t_back("a"); }
row("generic_hands_back", () => { const s: any = t_generic_hands_back(); return s; });
function t_wider_result(): string | number { return probe(); }
row("wider_result", () => { const s: any = t_wider_result(); return s; });
const anyProbe: any = probe;
function t_narrower_by_any(): string { return anyProbe(); }
row("narrower_by_any", () => { const s: any = t_narrower_by_any(); return s; });
const anyNumber: any = () => { probe(); return 1; };
function t_number_from_any(): number { return anyNumber(); }
row("number_from_any", () => { const s: any = t_number_from_any(); return s; });
function t_void_result(): void { return probe() as any; }
row("void_result", () => { const s: any = t_void_result(); return s; });
function t_unknown_result(): unknown { return probe(); }
row("unknown_result", () => { const s: any = t_unknown_result(); return s; });
function count(): number { probe(); return 1; }
function t_int_to_number(): number { return count(); }
row("int_to_number", () => { const s: any = t_int_to_number(); return s; });
interface P { seen: string }
function makeP(): P { return probeObject(); }
function t_object_result(): P { return makeP(); }
row("object_result", () => { const s: any = t_object_result(); return s; });
function t_union_result(): P | undefined { return makeP(); }
row("union_result", () => { const s: any = t_union_result(); return s; });
function ov(a: string): string;
function ov(a: number): number;
function ov(a: any): any { probe(); return a; }
function t_overload(): string { return ov("a"); }
row("overload", () => { const s: any = t_overload(); return s; });
