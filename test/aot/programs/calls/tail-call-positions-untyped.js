// Every syntactic position a call can be in, in JavaScript: the stack trace taken inside the callee shows whether the caller gave up its frame, as in plain Bun.
let seen = "";
function frames() { return String(new Error("x").stack).split("\n").filter(l => /t_[a-zA-Z0-9_]+/.test(l)).map(l => /(t_[a-zA-Z0-9_]+)/.exec(l)[1]).join(" "); }
function framesOf(e) { return String(e.stack).split("\n").filter((l) => /t_[a-zA-Z0-9_]+/.test(l)).map((l) => /(t_[a-zA-Z0-9_]+)/.exec(l)[1]).join(" "); }
function probe() { seen = frames(); return seen; }
function probeObject() { seen = frames(); return { seen }; }
function other() { return "other"; }
function row(name, f) { seen = "-"; try { f(); } catch (e) { seen = "threw " + e; } console.log(name + ": [" + seen + "]"); }
const yes = Date.now() > 0, no = !yes;
const nil = yes ? undefined : "x";
function t_return() { return probe(); }
row("return", () => { const s = t_return(); return s; });
const t_arrow = () => probe();
row("arrow", () => { const s = t_arrow(); return s; });
const t_arrow_block = () => { return probe(); };
row("arrow_block", () => { const s = t_arrow_block(); return s; });
const t_function_expression = function () { return probe(); };
row("function_expression", () => { const s = t_function_expression(); return s; });
function t_paren() { return (probe()); }
row("paren", () => { const s = t_paren(); return s; });
function t_paren2() { return ((probe())); }
row("paren2", () => { const s = t_paren2(); return s; });
function t_cond_yes() { return yes ? probe() : other(); }
row("cond_yes", () => { const s = t_cond_yes(); return s; });
function t_cond_no() { return no ? other() : probe(); }
row("cond_no", () => { const s = t_cond_no(); return s; });
function t_cond_const() { return yes ? probe() : "k"; }
row("cond_const", () => { const s = t_cond_const(); return s; });
function t_cond_test() { return probe() ? "a" : "b"; }
row("cond_test", () => { const s = t_cond_test(); return s; });
function t_cond_nested() { return yes ? (no ? other() : probe()) : other(); }
row("cond_nested", () => { const s = t_cond_nested(); return s; });
function t_and_right() { return yes && probe(); }
row("and_right", () => { const s = t_and_right(); return s; });
function t_and_left() { return probe() && no; }
row("and_left", () => { const s = t_and_left(); return s; });
function t_or_right() { return no || probe(); }
row("or_right", () => { const s = t_or_right(); return s; });
function t_or_left() { return probe() || no; }
row("or_left", () => { const s = t_or_left(); return s; });
function t_nullish_right() { return nil ?? probe(); }
row("nullish_right", () => { const s = t_nullish_right(); return s; });
function t_nullish_left() { return probe() ?? nil; }
row("nullish_left", () => { const s = t_nullish_left(); return s; });
function t_comma_last() { return other(), probe(); }
row("comma_last", () => { const s = t_comma_last(); return s; });
function t_comma_first() { return probe(), other(); }
row("comma_first", () => { const s = t_comma_first(); return s; });
function t_mixed() { return yes ? (yes && (other(), probe())) : (no || other()); }
row("mixed", () => { const s = t_mixed(); return s; });
const t_arrow_cond = () => (yes ? probe() : other());
row("arrow_cond", () => { const s = t_arrow_cond(); return s; });
const t_arrow_and = () => yes && probe();
row("arrow_and", () => { const s = t_arrow_and(); return s; });
function t_var_then_return() { var e; e = probe(); return e; }
row("var_then_return", () => { const s = t_var_then_return(); return s; });
function t_let_then_return() { let e; e = probe(); return e; }
row("let_then_return", () => { const s = t_let_then_return(); return s; });
function t_assign() { let e; return e = probe(); }
row("assign", () => { const s = t_assign(); return s; });
function t_plus() { return probe() + ""; }
row("plus", () => { const s = t_plus(); return s; });
function t_not() { return !probe(); }
row("not", () => { const s = t_not(); return s; });
function t_void() { return void probe(); }
row("void", () => { const s = t_void(); return s; });
function t_typeof() { return typeof probe(); }
row("typeof", () => { const s = t_typeof(); return s; });
function t_element() { return [probe(), other()][0]; }
row("element", () => { const s = t_element(); return s; });
function t_member() { return probe().length; }
row("member", () => { const s = t_member(); return s; });
function t_argument() { return String(probe()); }
row("argument", () => { const s = t_argument(); return s; });
function t_template() { return `${probe()}`; }
row("template", () => { const s = t_template(); return s; });
function t_statement() { probe(); }
row("statement", () => { const s = t_statement(); return s; });
function t_statement_then_return() { probe(); return; }
row("statement_then_return", () => { const s = t_statement_then_return(); return s; });
class t_K0 { constructor() { probe(); } }
function t_new() { return new t_K0(); }
row("new", () => { const s = t_new(); return s; });
function t_spread_in_array() { return [...probe()]; }
row("spread_in_array", () => { const s = t_spread_in_array(); return s; });
function t_object() { return { a: probe() }; }
row("object", () => { const s = t_object(); return s; });
function t_if() { if (yes) return probe(); return other(); }
row("if", () => { const s = t_if(); return s; });
function t_else() { if (no) return other(); else return probe(); }
row("else", () => { const s = t_else(); return s; });
function t_block() { { { return probe(); } } }
row("block", () => { const s = t_block(); return s; });
function t_labelled() { a: { if (no) break a; return probe(); } return other(); }
row("labelled", () => { const s = t_labelled(); return s; });
function t_while() { while (yes) { return probe(); } return other(); }
row("while", () => { const s = t_while(); return s; });
function t_do() { do { return probe(); } while (yes); }
row("do", () => { const s = t_do(); return s; });
function t_for() { for (let i = 0; i < 1; i++) { return probe(); } return other(); }
row("for", () => { const s = t_for(); return s; });
function t_for_closure() { for (let i = 0; i < 1; i++) { const g = () => i; if (g() === 0) return probe(); } return other(); }
row("for_closure", () => { const s = t_for_closure(); return s; });
function t_for_in() { for (const k in { a: 1 }) { return probe(); } return other(); }
row("for_in", () => { const s = t_for_in(); return s; });
function t_for_of() { for (const k of [1]) { return probe(); } return other(); }
row("for_of", () => { const s = t_for_of(); return s; });
function t_for_of_set() { for (const k of new Set([1])) { return probe(); } return other(); }
row("for_of_set", () => { const s = t_for_of_set(); return s; });
function t_for_of_string() { for (const k of "a") { return probe(); } return other(); }
row("for_of_string", () => { const s = t_for_of_string(); return s; });
function t_after_for_of() { for (const k of [1]) { other(); } return probe(); }
row("after_for_of", () => { const s = t_after_for_of(); return s; });
function t_after_for_in() { for (const k in { a: 1 }) { other(); } return probe(); }
row("after_for_in", () => { const s = t_after_for_in(); return s; });
function t_while_in_for_of() { for (const k of [1]) { while (yes) { return probe(); } } return other(); }
row("while_in_for_of", () => { const s = t_while_in_for_of(); return s; });
function t_for_of_in_while() { while (yes) { for (const k of [1]) { other(); } return probe(); } return other(); }
row("for_of_in_while", () => { const s = t_for_of_in_while(); return s; });
function t_switch() { switch (yes) { case true: return probe(); default: return other(); } }
row("switch", () => { const s = t_switch(); return s; });
function t_switch_default() { switch (yes) { case false: return other(); default: return probe(); } }
row("switch_default", () => { const s = t_switch_default(); return s; });
function t_switch_in_for_of() { for (const k of [1]) { switch (k) { case 1: return probe(); } } return other(); }
row("switch_in_for_of", () => { const s = t_switch_in_for_of(); return s; });
function t_try() { try { return probe(); } catch { return other(); } }
row("try", () => { const s = t_try(); return s; });
function t_try_rethrow() { try { return probe(); } catch (e) { throw e; } }
row("try_rethrow", () => { const s = t_try_rethrow(); return s; });
function t_try_finally() { try { return probe(); } finally { other(); } }
row("try_finally", () => { const s = t_try_finally(); return s; });
function t_try_empty_finally() { try { return probe(); } finally { } }
row("try_empty_finally", () => { const s = t_try_empty_finally(); return s; });
function t_catch() { try { throw 1; } catch { return probe(); } }
row("catch", () => { const s = t_catch(); return s; });
function t_catch_param() { try { throw 1; } catch (e) { return probe(); } }
row("catch_param", () => { const s = t_catch_param(); return s; });
function t_catch_with_finally() { try { throw 1; } catch { return probe(); } finally { other(); } }
row("catch_with_finally", () => { const s = t_catch_with_finally(); return s; });
function t_finally() { try { other(); } finally { return probe(); } }
row("finally", () => { const s = t_finally(); return s; });
function t_finally_after_catch() { try { throw 1; } catch { other(); } finally { return probe(); } }
row("finally_after_catch", () => { const s = t_finally_after_catch(); return s; });
function t_after_try() { try { other(); } catch { } return probe(); }
row("after_try", () => { const s = t_after_try(); return s; });
function t_after_try_finally() { try { other(); } finally { other(); } return probe(); }
row("after_try_finally", () => { const s = t_after_try_finally(); return s; });
function t_catch_in_try() { try { try { throw 1; } catch { return probe(); } } catch { return other(); } }
row("catch_in_try", () => { const s = t_catch_in_try(); return s; });
function t_finally_in_try() { try { try { other(); } finally { return probe(); } } catch { return other(); } }
row("finally_in_try", () => { const s = t_finally_in_try(); return s; });
function t_catch_in_catch() { try { throw 1; } catch { try { throw 2; } catch { return probe(); } } }
row("catch_in_catch", () => { const s = t_catch_in_catch(); return s; });
function t_catch_in_finally() { try { other(); } finally { try { throw 2; } catch { return probe(); } } }
row("catch_in_finally", () => { const s = t_catch_in_finally(); return s; });
function t_if_in_try() { try { if (yes) { return probe(); } } catch { } return other(); }
row("if_in_try", () => { const s = t_if_in_try(); return s; });
function t_closure_in_try() { try { const t_inner = () => probe(); var s; s = t_inner(); return s; } catch { return other(); } }
row("closure_in_try", () => { const s = t_closure_in_try(); return s; });
function t_while_in_catch() { try { throw 1; } catch { while (yes) { return probe(); } } return other(); }
row("while_in_catch", () => { const s = t_while_in_catch(); return s; });
class K1 { t_method() { return probe(); } }
row("method", () => { const s = new K1().t_method(); return s; });
class K2 { static t_static_method() { return probe(); } }
row("static_method", () => { const s = K2.t_static_method(); return s; });
class K3 { get t_getter() { return probe(); } }
row("getter", () => { const s = new K3().t_getter; return s; });
class K4 { set t_setter(v) { probe(); } }
row("setter", () => { const s = new K4().t_setter = "a"; return s; });
class K5 { #t_private_method() { return probe(); } t_outer() { var s; s = this.#t_private_method(); return s; } }
row("private_method", () => { const s = new K5().t_outer(); return s; });
class K6 { t_field_arrow = () => probe(); }
row("field_arrow", () => { const s = new K6().t_field_arrow(); return s; });
const o1 = { t_object_method() { return probe(); } };
row("object_method", () => { const s = o1.t_object_method(); return s; });
const o2 = { get t_object_getter() { return probe(); } };
row("object_getter", () => { const s = o2.t_object_getter; return s; });
const o3 = { t_object_arrow: () => probe() };
row("object_arrow", () => { const s = o3.t_object_arrow(); return s; });
function t_function_called() { return probeObject(); }
row("function_called", () => { const s = t_function_called(); return s; });
async function t_async() { return probe(); }
row("async", () => { const s = t_async(); return s; });
const t_async_arrow = async () => probe();
row("async_arrow", () => { const s = t_async_arrow(); return s; });
function* t_generator() { return probe(); }
row("generator", () => { const s = t_generator().next(); return s; });
async function* t_async_generator() { return probe(); }
row("async_generator", () => { const s = t_async_generator().next(); return s; });
class K7 { async t_async_method() { return probe(); } }
row("async_method", () => { const s = new K7().t_async_method(); return s; });
function t_nested() { function t_nested_inner() { return probe(); } return t_nested_inner(); }
row("nested", () => { const s = t_nested(); return s; });
function t_nested_kept() { function t_nested_inner2() { return probe(); } var s; s = t_nested_inner2(); return s; }
row("nested_kept", () => { const s = t_nested_kept(); return s; });
function t_iife() { return (() => probe())(); }
row("iife", () => { const s = t_iife(); return s; });
function t_default_parameter(a = probe()) { return a; }
row("default_parameter", () => { const s = t_default_parameter(); return s; });
function t_by_value(f) { return f(); }
row("by_value", () => { const s = t_by_value(probe); return s; });
function t_by_value_any(f) { return f(); }
row("by_value_any", () => { const s = t_by_value_any(probe); return s; });
function t_by_value_any_held(f) { return f(); }
row("by_value_any_held", () => { const s = t_by_value_any_held(probe); return s; });
const o4 = { m: probe };
function t_by_name() { return o4.m(); }
row("by_name", () => { const s = t_by_name(); return s; });
const o5 = { m: probe };
function t_by_key(k) { return o5[k](); }
row("by_key", () => { const s = t_by_key("m"); return s; });
function t_optional_call(f) { return f?.(); }
row("optional_call", () => { const s = t_optional_call(probe); return s; });
function t_optional_member(o) { return o?.m(); }
row("optional_member", () => { const s = t_optional_member(o4); return s; });
function t_optional_method(o) { return o.m?.(); }
row("optional_method", () => { const s = t_optional_method(o4); return s; });
function t_optional_long(o) { return o?.a?.b.m(); }
row("optional_long", () => { const s = t_optional_long({ a: { b: o4 } }); return s; });
function t_optional_inner(o) { return o?.m().length; }
row("optional_inner", () => { const s = t_optional_inner(o4); return s; });
function t_optional_paren(o) { return (o?.m)(); }
row("optional_paren", () => { const s = t_optional_paren(o4); return s; });
function tag(s) { return probe(); }
function t_tagged() { return tag`x`; }
row("tagged", () => { const s = t_tagged(); return s; });
const o6 = { tag(s) { return probe(); } };
function t_tagged_member() { return o6.tag`x`; }
row("tagged_member", () => { const s = t_tagged_member(); return s; });
function t_call() { return probe.call(undefined); }
row("call", () => { const s = t_call(); return s; });
function t_apply() { return probe.apply(undefined, []); }
row("apply", () => { const s = t_apply(); return s; });
function t_apply_arguments() { return probe.apply(undefined, arguments); }
row("apply_arguments", () => { const s = t_apply_arguments(); return s; });
const none = [];
function t_spread() { return probe(...none); }
row("spread", () => { const s = t_spread(); return s; });
function t_spread_method() { return o4.m(...none); }
row("spread_method", () => { const s = t_spread_method(); return s; });
function t_reflect_apply() { return Reflect.apply(probe, undefined, []); }
row("reflect_apply", () => { const s = t_reflect_apply(); return s; });
const bound = probe.bind(undefined);
function t_bound() { return bound(); }
row("bound", () => { const s = t_bound(); return s; });
function t_comma_callee() { return (0, o4.m)(); }
row("comma_callee", () => { const s = t_comma_callee(); return s; });
function maker() { return probe; }
function t_call_of_call() { return maker()(); }
row("call_of_call", () => { const s = t_call_of_call(); return s; });
function t_maker() { probe(); return other; }
function t_call_of_call_inner() { return t_maker()(); }
row("call_of_call_inner", () => { const s = t_call_of_call_inner(); return s; });
class B1 { m() { return probe(); } }
class D1 extends B1 { t_super_method() { return super.m(); } }
row("super_method", () => { const s = new D1().t_super_method(); return s; });
class K8 { m() { return probe(); } t_this_method() { return this.m(); } }
row("this_method", () => { const s = new K8().t_this_method(); return s; });
class K9 { static m() { return probe(); } static t_static_this() { return this.m(); } }
row("static_this", () => { const s = K9.t_static_this(); return s; });
function t_callback() { return [1].map(() => probe()); }
row("callback", () => { const s = t_callback(); return s; });
function t_callback_named() { return [1].map(function t_cb() { return probe(); }); }
row("callback_named", () => { const s = t_callback_named(); return s; });
const o7 = { get g() { return probe(); } };
function t_getter_read() { return o7.g; }
row("getter_read", () => { const s = t_getter_read(); return s; });
const px = new Proxy(probe, {});
function t_proxy() { return px(); }
row("proxy", () => { const s = t_proxy(); return s; });
const px2 = new Proxy(other, { apply() { return probe(); } });
function t_proxy_trap() { return px2(); }
row("proxy_trap", () => { const s = t_proxy_trap(); return s; });
function t_builtin_throws() { return JSON.parse("{"); }
function t_reads_trace() { try { var s; s = t_builtin_throws(); return s; } catch (e) { seen = String(e.stack).split("\n").filter((l) => /t_[a-z_]+/.test(l)).map((l) => /(t_[a-z_]+)/.exec(l)[1]).join(" "); } }
row("builtin_throws", () => { const s = t_reads_trace(); return s; });
const stringy = { toString() { return probe(); } };
function t_builtin_to_string() { return String(stringy); }
row("builtin_to_string", () => { const s = t_builtin_to_string(); return s; });
function t_builtin_sort() { return [2, 1].sort((a, b) => (probe(), a - b)); }
row("builtin_sort", () => { const s = t_builtin_sort(); return s; });
function t_builtin_replace() { return "a".replace(/a/, () => probe()); }
row("builtin_replace", () => { const s = t_builtin_replace(); return s; });
function t_builtin_for_each() { return [1].forEach(() => { probe(); }); }
row("builtin_for_each", () => { const s = t_builtin_for_each(); return s; });
function t_builtin_filter() { return [1].filter(() => probe()); }
row("builtin_filter", () => { const s = t_builtin_filter(); return s; });
function t_builtin_reduce() { return [1, 2].reduce((a, b) => (probe(), a + b)); }
row("builtin_reduce", () => { const s = t_builtin_reduce(); return s; });
function t_builtin_from() { return Array.from([1], () => probe()); }
row("builtin_from", () => { const s = t_builtin_from(); return s; });
const px3 = new Proxy({}, { ownKeys() { probe(); return []; } });
function t_builtin_keys_of_proxy() { return Object.keys(px3); }
row("builtin_keys_of_proxy", () => { const s = t_builtin_keys_of_proxy(); return s; });
function t_builtin_map_for_each() { return new Map([[1, 1]]).forEach(() => { probe(); }); }
row("builtin_map_for_each", () => { const s = t_builtin_map_for_each(); return s; });
function t_builtin_stringify() { return JSON.stringify({ toJSON() { return probe(); } }); }
row("builtin_stringify", () => { const s = t_builtin_stringify(); return s; });
const numbery = { valueOf() { probe(); return 1; } };
function t_builtin_number() { return Number(numbery); }
row("builtin_number", () => { const s = t_builtin_number(); return s; });
function t_builtin_math() { return Math.max(numbery, 2); }
row("builtin_math", () => { const s = t_builtin_math(); return s; });
function t_not_a_function(f) { return f(); }
row("not_a_function", () => { try { t_not_a_function(undefined); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_not_a_function_number(f) { return f(1, 2); }
row("not_a_function_number", () => { try { t_not_a_function_number(5); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_not_a_function_object(f) { return f(); }
row("not_a_function_object", () => { try { t_not_a_function_object({}); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_no_such_method(o) { return o.nothing(); }
row("no_such_method", () => { try { t_no_such_method({}); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_method_of_null(o) { return o.nothing(); }
row("method_of_null", () => { try { t_method_of_null(null); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_method_is_a_number(o) { return o.k(1); }
row("method_is_a_number", () => { try { t_method_is_a_number({ k: 1 }); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
class Klass { }
function t_class_called(f) { return f(); }
row("class_called", () => { try { t_class_called(Klass); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
const o8 = { get m() { throw new Error("getter"); } };
function t_getter_throws(o) { return o.m(); }
row("getter_throws", () => { try { t_getter_throws(o8); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_thrower() { throw new Error("thrown"); }
function t_callee_throws() { return t_thrower(); }
row("callee_throws", () => { try { t_callee_throws(); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_callee_throws_by_value(f) { return f(); }
row("callee_throws_by_value", () => { try { t_callee_throws_by_value(t_thrower); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_argument_throws() { return (other)(t_thrower()); }
row("argument_throws", () => { try { t_argument_throws(); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_apply_not_a_function(f) { return f.apply(undefined, []); }
row("apply_not_a_function", () => { try { t_apply_not_a_function({}); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_tag_not_a_function(f) { return f`x`; }
row("tag_not_a_function", () => { try { t_tag_not_a_function(undefined); } catch (e) { seen = e.constructor.name + " " + framesOf(e); } });
function t_captures(cut) { const o = {}; (Error).captureStackTrace(o, cut); seen = framesOf(o); return seen; }
function t_capture() { return t_captures(undefined); }
row("capture", () => { const s = t_capture(); return s; });
function t_capture_cut_at_leaf() { return t_captures(t_captures); }
row("capture_cut_at_leaf", () => { const s = t_capture_cut_at_leaf(); return s; });
function t_gone() { return t_captures(t_gone); }
function t_capture_cut_at_gone() { var s; s = t_gone(); return s; }
row("capture_cut_at_gone", () => { const s = t_capture_cut_at_gone(); return s; });
function t_kept() { var s; s = t_captures(t_kept); return s; }
function t_capture_cut_at_kept() { var s; s = t_kept(); return s; }
row("capture_cut_at_kept", () => { const s = t_capture_cut_at_kept(); return s; });
function t_mid(cut) { return t_captures(cut); }
function t_capture_through_tail() { var s; s = t_mid(t_capture_through_tail); return s; }
row("capture_through_tail", () => { const s = t_capture_through_tail(); return s; });
function t_capture_by_value(f) { return f(undefined); }
row("capture_by_value", () => { const s = t_capture_by_value(t_captures); return s; });
function t_limit3() { const was = (Error).stackTraceLimit; (Error).stackTraceLimit = 2; seen = frames(); (Error).stackTraceLimit = was; return seen; }
function t_limit2() { return t_limit3(); }
function t_stack_limit() { var s; s = t_limit2(); return s; }
row("stack_limit", () => { const s = t_stack_limit(); return s; });
function t_c3() { return probe(); }
function t_c2() { return t_c3(); }
function t_chain3() { return t_c2(); }
row("chain3", () => { const s = t_chain3(); return s; });
function t_d3() { return probe(); }
function t_d2() { return t_d3(); }
function t_chain_kept_top() { var s; s = t_d2(); return s; }
row("chain_kept_top", () => { const s = t_chain_kept_top(); return s; });
function t_e3() { return probe(); }
function t_e2() { var s; s = t_e3(); return s; }
function t_chain_kept_middle() { return t_e2(); }
row("chain_kept_middle", () => { const s = t_chain_kept_middle(); return s; });
function t_f3() { var s; s = probe(); return s; }
function t_f2() { return t_f3(); }
function t_chain_kept_leaf() { return t_f2(); }
row("chain_kept_leaf", () => { const s = t_chain_kept_leaf(); return s; });
function t_g2(a, b, c) { return c ? probe() : b + a; }
function t_with_arguments(a) { return t_g2(a + 1, "x", yes); }
row("with_arguments", () => { const s = t_with_arguments(1); return s; });
function t_h2(a, b, c, d, e, f, g, h, i, j, k, l) { return a + b + c + d + e + f + g + h + i + j + k + l > 0 ? probe() : other(); }
function t_many_arguments(a) { return t_h2(a, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); }
row("many_arguments", () => { const s = t_many_arguments(1); return s; });
function t_i2(a, b) { return probe(); }
function t_fewer_arguments() { return t_i2(); }
row("fewer_arguments", () => { const s = t_fewer_arguments(); return s; });
function t_j2(...a) { return probe(); }
function t_rest() { return t_j2(1, 2, 3); }
row("rest", () => { const s = t_rest(); return s; });
function t_recursion(n) { return n === 0 ? probe() : t_recursion(n - 1); }
row("recursion", () => { const s = t_recursion(5); return s; });
function t_recursion_kept(n) { if (n === 0) return probe(); var s; s = t_recursion_kept(n - 1); return s; }
row("recursion_kept", () => { const s = t_recursion_kept(3); return s; });
function t_k2() { seen = frames(); throw new Error("thrown"); }
function t_throws() { return t_k2(); }
function t_catches() { try { return t_throws(); } catch (e) { return "caught"; } }
row("throws", () => { const s = t_catches(); return s; });
