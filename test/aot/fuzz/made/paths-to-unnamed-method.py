#!/usr/bin/env python3
"""paths-to-unnamed-method.py <folder>: A method or accessor of a typed class that nothing can ask for is not compiled. In no program here is the name of the member written as a property or as one text: it is glued at run time, or it is the language or the host that asks. One road a program, because types that rows share change what is laid out. w*: nothing of the host is needed. b*: functions of the host."""
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = 'declare const console: { log(...values: any[]): void };\nexport { };\nconst glue = (a: string, b: string): string => a + b;\n'
HEADB = 'export { };\nconst glue = (a: string, b: string): string => a + b;\n'
W = {
# ---- the language asks an object that stands in a TYPED place (a view of lib.d.ts): no "let out", and the name is none of the 40
'set_like_size_has_keys': '''class Like { get size(): number { return 2; } has(v: number): boolean { return v === 1 || v === 5; } keys(): Iterator<number> { return [1, 5][Symbol.iterator](); } }
console.log([...new Set([1, 2, 3]).union(new Like())].join(), [...new Set([1, 2, 3]).intersection(new Like())].join(), new Set([1]).isSubsetOf(new Like()));''',
'number_format_options': '''class Options { get minimumFractionDigits(): number { return 3; } get useGrouping(): boolean { return false; } }
console.log((1234.5).toLocaleString("en-US", new Options()));''',
'collator_options': '''class Options { get numeric(): boolean { return true; } }
console.log("a10".localeCompare("a9", "en", new Options()), "a10".localeCompare("a9", "en"));''',
'date_format_options': '''class Options { get timeZone(): string { return "UTC"; } get year(): "numeric" { return "numeric"; } }
console.log(new Date(0).toLocaleDateString("en-US", new Options()));''',
'list_format_options': '''class Options { get type(): "disjunction" { return "disjunction"; } }
console.log(new Intl.ListFormat("en", new Options()).format(["a", "b", "c"]));''',
'string_raw': '''class Cooked { get raw(): string[] { return ["x", "y", "z"]; } }
console.log(String.raw(new Cooked(), 1, 2));''',
'array_buffer_options': '''class Options { get maxByteLength(): number { return 64; } }
const buffer = new ArrayBuffer(8, new Options()); console.log(buffer.resizable, buffer.byteLength);''',
'array_like_elements': '''class Like { get length(): number { return 2; } get 0(): string { return "zero"; } get 1(): string { return "one"; } [index: number]: string; }
console.log(Array.from(new Like()).join());''',
'concat_array': '''class Opts { get flags(): string { return "g"; } }
console.log(typeof new Opts());''',
'descriptor_by_getters': '''class Descriptor { get value(): number { return 5; } get enumerable(): boolean { return true; } }
const made: Record<string, number> = {}; Object.defineProperty(made, "p", new Descriptor()); console.log(JSON.stringify(made));''',
'error_options': '''class Options { get cause(): string { return "the cause"; } }
console.log(new Error("m", new Options()).cause);''',
'iterator_from': '''class Steps { i = 0; next(): IteratorResult<number> { return this.i < 3 ? { done: false, value: this.i++ } : { done: true, value: undefined }; } }
console.log([...Iterator.from(new Steps())].join());''',
'result_by_getters': '''class Result { constructor(private n: number) { } get done(): boolean { return this.n > 1; } get value(): number { return this.n; } }
class Steps { i = 0; next(): IteratorResult<number> { return new Result(this.i++) as IteratorResult<number>; } [Symbol.iterator](): Steps { return this; } }
console.log([...new Steps()].join());''',
'segmenter_options': '''class Options { get granularity(): "word" { return "word"; } }
console.log([...new Intl.Segmenter("en", new Options()).segment("a b")].length);''',
'plural_rules_options': '''class Options { get type(): "ordinal" { return "ordinal"; } }
console.log(new Intl.PluralRules("en", new Options()).select(2));''',
# ---- `this` of a built-in
'join_by_array_to_string': '''class Joins { join(): string { return "joined"; } }
console.log(Array.prototype.toString.call(new Joins()));''',
'to_iso_string_by_to_json': '''class Dated { toISOString(): string { return "iso"; } }
console.log(Date.prototype.toJSON.call(new Dated(), ""));''',
'exec_by_test': '''class Execs { exec(s: string): null { console.log("asked", s); return null; } }
console.log(RegExp.prototype.test.call(new Execs(), "s"));''',
'source_and_flags': '''class Shown { get source(): string { return "src"; } get flags(): string { return "fl"; } }
console.log(RegExp.prototype.toString.call(new Shown()));''',
'name_and_message': '''class Failing { get name(): string { return "N"; } get message(): string { return "M"; } }
console.log(Error.prototype.toString.call(new Failing()));''',
# ---- typed code, a key that is not constant
'generic_keyof': '''class C { alpha(): string { return "alpha"; } }
function call<T, K extends keyof T>(o: T, k: K): unknown { return (o[k] as () => unknown)(); }
console.log(call(new C(), glue("al", "pha") as "alpha"));''',
'generic_bounded': '''class Base { alpha(): string { return "alpha of Base"; } }
class Heir extends Base { beta(): string { return "beta"; } }
function call<T extends Base>(o: T, k: keyof T): unknown { return (o[k] as () => unknown)(); }
console.log(call(new Heir(), glue("be", "ta") as "beta"), call(new Heir(), glue("al", "pha") as "alpha"));''',
'this_by_key_in_the_base': '''class Base { run(k: string): unknown { return (this as unknown as Record<string, () => unknown>)[k]!(); } }
class Heir extends Base { alpha(): string { return "alpha"; } }
console.log(new Heir().run(glue("al", "pha")));''',
'this_by_keyof_this': '''class Base { run(k: keyof this): unknown { return (this[k] as () => unknown)(); } }
class Heir extends Base { alpha(): string { return "alpha"; } }
console.log(new Heir().run(glue("al", "pha") as "alpha"));''',
'computed_destructuring': '''class C { alpha(): string { return "alpha"; } }
const k = glue("al", "pha") as "alpha"; const { [k]: taken } = new C(); console.log(taken.call(new C()));''',
'optional_chain_by_key': '''class C { alpha(): string { return "alpha"; } }
function maybe(o: C | undefined, k: "alpha"): string | undefined { return o?.[k]?.(); }
console.log(maybe(new C(), glue("al", "pha") as "alpha"), maybe(undefined, "alpha"));''',
'union_of_classes': '''class A { alpha(): string { return "alpha of A"; } }
class B { alpha(): string { return "alpha of B"; } }
function call(o: A | B, k: "alpha"): string { return o[k](); }
console.log(call(new A(), glue("al", "pha") as "alpha"), call(new B(), glue("al", "pha") as "alpha"));''',
'keys_in_an_array': '''class C { alpha(): string { return "alpha"; } beta(): string { return "beta"; } }
const o = new C(); const out: string[] = []; for (const k of [glue("al", "pha"), glue("be", "ta")] as ("alpha" | "beta")[]) out.push(o[k]()); console.log(out.join());''',
'a_string_enum': '''enum Names { A = "alpha" }
class C { alpha(): string { return "alpha"; } }
function call(o: C, k: Names): string { return o[k](); }
console.log(call(new C(), glue("al", "pha") as Names));''',
'intersection': '''class C { alpha(): string { return "alpha"; } }
function call(o: C & { more?: number }, k: "alpha"): string { return o[k](); }
console.log(call(new C(), glue("al", "pha") as "alpha"));''',
'readonly_of_it': '''class C { alpha(): string { return "alpha"; } }
function call(o: Readonly<C>, k: keyof C): string { return o[k](); }
console.log(call(new C(), glue("al", "pha") as "alpha"));''',
'pick_of_it': '''class C { alpha(): string { return "alpha"; } beta(): string { return "beta"; } }
function call(o: Pick<C, "alpha">, k: "alpha"): string { return o[k](); }
console.log(call(new C(), glue("al", "pha") as "alpha"));''',
'numbered_methods': '''class Numbered { 1(): string { return "one"; } 2(): string { return "two"; } }
function at(o: Numbered, i: 1 | 2): string { return o[i](); }
console.log(at(new Numbered(), ("x".length) as 1), at(new Numbered(), ("xx".length) as 2));''',
'a_bound_method_by_key': '''class C { word = "w"; alpha(): string { return "alpha " + this.word; } }
const o = new C(); const bound = o[glue("al", "pha") as "alpha"].bind(o); console.log(bound());''',
'has_by_key_then_call': '''class C { alpha(): string { return "alpha"; } }
function call(o: C, k: string): unknown { return k in o ? (o as unknown as Record<string, () => unknown>)[k]!() : "no"; }
console.log(call(new C(), glue("al", "pha")), call(new C(), "nope"));''',
# ---- a class that only FITS another (no extends)
'fits_without_extends': '''class A { alpha(): string { return "alpha of A"; } }
class B { alpha(): string { return "alpha of B"; } }
function call(o: A, k: "alpha"): string { return o[k](); }
const fits: A = new B(); console.log(call(fits, glue("al", "pha") as "alpha"));''',
'fits_with_more': '''class A { alpha(): string { return "alpha of A"; } }
class B { alpha(): string { return "alpha of B"; } beta(): string { return "beta of B"; } }
function call(o: A, k: string): unknown { return (o as unknown as Record<string, () => unknown>)[k]!(); }
const fits: A = new B(); console.log(call(fits, glue("be", "ta")));''',
# ---- the setter, written by somebody else
'assign_writes_the_setter': '''class C { seen = 0; set mu(v: number) { this.seen = v + 1; } }
const source: Record<string, number> = {}; source[glue("m", "u")] = 4; console.log(Object.assign(new C(), source).seen);''',
'reflect_set': '''class C { seen = 0; set mu(v: number) { this.seen = v + 1; } }
const o = new C(); Reflect.set(o, glue("m", "u"), 4); console.log(o.seen);''',
'typed_write_by_key': '''class C { seen = 0; set mu(v: number) { this.seen = v + 1; } get mu(): number { return this.seen; } }
function put(o: C, k: "mu", v: number): void { o[k] = v; }
const o = new C(); put(o, glue("m", "u") as "mu", 4); console.log(o.seen);''',
'getter_in_base_setter_in_heir': '''class Base { held = 1; get mu(): number { return this.held; } }
class Heir extends Base { override get mu(): number { return super.mu + 10; } override set mu(v: number) { this.held = v; } }
function read(o: Base, k: "mu"): number { return o[k]; }
console.log(read(new Heir(), glue("m", "u") as "mu"), read(new Base(), glue("m", "u") as "mu"));''',
# ---- reflection
'reflect_get': '''class C { alpha(): string { return "alpha"; } }
console.log((Reflect.get(new C(), glue("al", "pha")) as () => string)());''',
'prototype_of_the_object': '''class C { alpha(): string { return "alpha"; } }
console.log(Object.getPrototypeOf(new C())[glue("al", "pha")]());''',
'descriptor_of_the_prototype': '''class C { alpha(): string { return "alpha"; } get kappa(): string { return "kappa"; } }
console.log(Object.getOwnPropertyDescriptor(C.prototype, glue("al", "pha"))!.value(), Object.getOwnPropertyDescriptor(C.prototype, glue("kap", "pa"))!.get!.call(new C()));''',
'descriptors_of_the_prototype': '''class C { alpha(): string { return "alpha"; } }
const all = Object.getOwnPropertyDescriptors(C.prototype) as Record<string, PropertyDescriptor>; console.log(all[glue("al", "pha")]!.value());''',
'create_from_the_prototype': '''class C { alpha(): string { return "alpha"; } }
console.log(Object.create(C.prototype)[glue("al", "pha")]());''',
'set_prototype_of_a_plain_object': '''class C { alpha(): string { return "alpha"; } }
const plain: any = {}; Object.setPrototypeOf(plain, C.prototype); console.log(plain[glue("al", "pha")]());''',
'constructor_of_the_object': '''class C { alpha(): string { return "alpha"; } }
function again(o: C): any { return new (o.constructor as new () => any)(); }
console.log(again(new C())[glue("al", "pha")]());''',
'lookup_getter': '''class C { get kappa(): string { return "kappa"; } }
console.log((Object.prototype as any).__lookupGetter__.call(new C(), glue("kap", "pa")).call(new C()));''',
'own_keys_of_the_prototype': '''class C { alpha(): string { return "alpha"; } }
const o = new C(); console.log(Reflect.ownKeys(Object.getPrototypeOf(o) as object).filter(k => k !== "constructor").map(k => (Reflect.get(o, k) as () => string).call(o)).join());''',
# ---- roads out
'thrown_and_caught': '''class C { alpha(): string { return "alpha"; } }
try { throw new C(); } catch (e) { console.log((e as any)[glue("al", "pha")]()); }''',
'yielded': '''class C { alpha(): string { return "alpha"; } }
function* gives(): Generator<C> { yield new C(); }
function takes(all: Iterable<unknown>): unknown { for (const one of all) return (one as any)[glue("al", "pha")](); return "none"; }
console.log(takes(gives()));''',
'awaited': '''class C { alpha(): string { return "alpha"; } }
async function gives(): Promise<C> { return new C(); }
const given: Promise<unknown> = gives(); console.log(((await given) as any)[glue("al", "pha")]());''',
'a_field_of_type_unknown': '''class C { alpha(): string { return "alpha"; } }
class Holder { held: unknown = new C(); }
console.log((new Holder().held as any)[glue("al", "pha")]());''',
'an_array_seen_as_unknowns': '''class C { alpha(): string { return "alpha"; } }
const typed: C[] = [new C()]; const seen: readonly unknown[] = typed; console.log((seen[0] as any)[glue("al", "pha")]());''',
'a_map_seen_as_unknowns': '''class C { alpha(): string { return "alpha"; } }
const typed = new Map<string, C>([["k", new C()]]); const seen: ReadonlyMap<string, unknown> = typed; console.log((seen.get("k") as any)[glue("al", "pha")]());''',
'a_callback_that_takes_any': '''class C { alpha(): string { return "alpha"; } }
const loose = (x: any): unknown => x[glue("al", "pha")](); console.log([new C()].map(loose).join());''',
'a_callback_in_a_typed_field': '''class C { alpha(): string { return "alpha"; } }
class Caller { constructor(public f: (x: C) => unknown) { } go(): unknown { return this.f(new C()); } }
console.log(new Caller((x: any) => x[glue("al", "pha")]()).go());''',
'as_this_of_an_untyped_function': '''class C { alpha(): string { return "alpha"; } }
function loose(this: any, k: string): unknown { return this[k](); }
console.log(loose.call(new C(), glue("al", "pha")));''',
'reflect_apply': '''class C { alpha(): string { return "alpha"; } }
function loose(this: any, k: string): unknown { return this[k](); }
console.log(Reflect.apply(loose, new C(), [glue("al", "pha")]));''',
'the_replacer_sees_it': '''class C { n = 1; alpha(): string { return "alpha"; } }
console.log(JSON.stringify({ c: new C() }, (key: string, value: any) => key === "c" ? value[glue("al", "pha")]() : value));''',
'on_global_this': '''class C { alpha(): string { return "alpha"; } }
(globalThis as any).kept = new C(); console.log((globalThis as any).kept[glue("al", "pha")]());''',
'returned_as_a_generic': '''class C { alpha(): string { return "alpha"; } }
function same<T>(x: T): T { return x; }
const out: any = same<any>(new C()); console.log(out[glue("al", "pha")]());''',
'satisfies_then_object': '''class C { alpha(): string { return "alpha"; } }
const o: object = new C() satisfies object; console.log((o as any)[glue("al", "pha")]());''',
'a_tagged_template': '''class C { alpha(): string { return "alpha"; } }
function tag(strings: TemplateStringsArray, ...values: unknown[]): unknown { return (values[0] as any)[glue("al", "pha")](); }
console.log(tag`a${new C()}b`);''',
'rest_arguments': '''class C { alpha(): string { return "alpha"; } }
function loose(...all: unknown[]): unknown { return (all[0] as any)[glue("al", "pha")](); }
console.log(loose(new C()));''',
'the_arguments_object': '''class C { alpha(): string { return "alpha"; } }
function loose(o: C): unknown { return arguments[0][glue("al", "pha")](); }
console.log(loose(new C()));''',
'a_literal_that_holds_it': '''class C { alpha(): string { return "alpha"; } }
const holder = { c: new C() }; const seen: Record<string, unknown> = holder; console.log((seen[glue("", "c")] as any)[glue("al", "pha")]());''',
'object_values': '''class C { alpha(): string { return "alpha"; } }
const seen: unknown[] = Object.values({ c: new C() }); console.log((seen[0] as any)[glue("al", "pha")]());''',
'a_weak_ref': '''class C { alpha(): string { return "alpha"; } }
const kept = new C(); const ref: WeakRef<object> = new WeakRef(kept); console.log((ref.deref() as any)[glue("al", "pha")]());''',
'a_promise_reaction_that_takes_any': '''class C { alpha(): string { return "alpha"; } }
console.log(await Promise.resolve(new C()).then((x: any) => x[glue("al", "pha")]()));''',
'a_sort_comparator_that_takes_any': '''class C { constructor(public n: number) { } alpha(): number { return this.n; } }
console.log([new C(2), new C(1)].sort((a: any, b: any) => a[glue("al", "pha")]() - b[glue("al", "pha")]()).map(c => c.n).join());''',
'a_proxy_over_it': '''class C { alpha(): string { return "alpha"; } }
const over = new Proxy(new C(), {}); console.log((over as any)[glue("al", "pha")]());''',
'a_proxy_trap_gets_the_target': '''class C { alpha(): string { return "alpha"; } }
const over = new Proxy(new C(), { get(target: any, k: string) { return k === "go" ? target[glue("al", "pha")]() : undefined; } }); console.log((over as any).go);''',
# ---- the class object
'the_namespace_by_key': None,
'a_class_in_a_typed_array': '''class C { alpha(): string { return "alpha"; } }
const makers: (new () => C)[] = [C]; const made: unknown = new makers[0]!(); console.log((made as any)[glue("al", "pha")]());''',
'a_class_expression': '''const K = class { alpha(): string { return "alpha"; } };
const made: unknown = new K(); console.log((made as any)[glue("al", "pha")]());''',
'reflect_construct': '''class C { alpha(): string { return "alpha"; } }
console.log((Reflect.construct(C, []) as any)[glue("al", "pha")]());''',
'a_static_that_holds_itself': '''class C { static self: unknown = C; alpha(): string { return "alpha"; } }
console.log(new (C.self as any)()[glue("al", "pha")]());''',
'an_heir_made_of_any': '''class C { alpha(): string { return "alpha"; } }
const parent: any = C; class Heir extends parent { } console.log((new Heir() as any)[glue("al", "pha")]());''',
'a_mixin': '''class Base { alpha(): string { return "alpha"; } }
function Mixed<T extends new (...all: any[]) => object>(parent: T) { return class extends parent { beta(): string { return "beta"; } }; }
class Final extends Mixed(Base) { gamma(): string { return "gamma"; } }
const o: any = new Final(); console.log(o[glue("al", "pha")](), o[glue("be", "ta")](), o[glue("gam", "ma")]());''',
'an_abstract_class': '''abstract class Shape { abstract alpha(): string; both(k: "alpha"): string { return this[k](); } }
class Round extends Shape { alpha(): string { return "alpha of Round"; } }
console.log(new Round().both(glue("al", "pha") as "alpha"));''',
'an_interface_merged_with_the_class': '''interface C { beta?(): string }
class C { alpha(): string { return "alpha"; } }
function call(o: C, k: keyof C): unknown { const f = o[k]; return f ? f.call(o) : "none"; }
console.log(call(new C(), glue("al", "pha") as "alpha"), call(new C(), glue("be", "ta") as "beta"));''',
'a_getter_overridden_by_a_field': '''class Base { get kappa(): string { return "kappa of Base"; } }
class Heir extends Base { }
function read(o: Base, k: "kappa"): string { return o[k]; }
console.log(read(new Heir(), glue("kap", "pa") as "kappa"));''',
'replaced_on_the_prototype': '''class C { alpha(): string { return "alpha"; } beta(): string { return "beta"; } }
(C.prototype as any)[glue("al", "pha")] = function (this: any): string { return "new " + this[glue("be", "ta")](); };
console.log((new C() as any)[glue("al", "pha")]());''',
# ---- what kind of function the member is
'an_async_method': '''class C { async alpha(): Promise<string> { await null; return "alpha"; } }
function call(o: C, k: "alpha"): Promise<string> { return o[k](); }
console.log(await call(new C(), glue("al", "pha") as "alpha"));''',
'a_generator_method': '''class C { *alpha(): Generator<string> { yield "al"; yield "pha"; } }
function call(o: C, k: "alpha"): Generator<string> { return o[k](); }
console.log([...call(new C(), glue("al", "pha") as "alpha")].join(""));''',
'an_async_generator_method': '''class C { async *alpha(): AsyncGenerator<string> { yield "al"; yield "pha"; } }
function call(o: C, k: "alpha"): AsyncGenerator<string> { return o[k](); }
const out: string[] = []; for await (const s of call(new C(), glue("al", "pha") as "alpha")) out.push(s); console.log(out.join(""));''',
'a_method_with_defaults_and_rest': '''class C { alpha(a = 1, ...more: number[]): number { return a + more.length; } }
function call(o: C, k: "alpha"): number { return o[k]() + o[k](2, 3, 4); }
console.log(call(new C(), glue("al", "pha") as "alpha"));''',
'a_class_evaluated_twice': '''function make(tag: string) { return class { alpha(): string { return "alpha " + tag; } }; }
const A = make("a"), B = make("b"); console.log((new A() as any)[glue("al", "pha")](), (new B() as any)[glue("al", "pha")]());''',
'a_generic_class': '''class Box<T> { constructor(public v: T) { } alpha(): T { return this.v; } }
function call<T>(o: Box<T>, k: "alpha"): T { return o[k](); }
console.log(call(new Box("boxed"), glue("al", "pha") as "alpha"), call(new Box(5), glue("al", "pha") as "alpha"));''',
}
del W['the_namespace_by_key']; del W['concat_array']
B = {
'event_listener_options': '''class Options { get once(): boolean { return true; } }
let n = 0; const t = new EventTarget(); t.addEventListener("p", () => { n++; }, new Options()); t.dispatchEvent(new Event("p")); t.dispatchEvent(new Event("p")); console.log(n);''',
'handle_event': '''class Listener { n = 0; handleEvent(e: Event): void { this.n++; console.log("handled", e.type); } }
const t = new EventTarget(); t.addEventListener("p", new Listener()); t.dispatchEvent(new Event("p"));''',
'event_init': '''class Init { get cancelable(): boolean { return true; } }
console.log(new Event("p", new Init()).cancelable);''',
'custom_event_init': '''class Init { get detail(): string { return "the detail"; } }
console.log(new CustomEvent("p", new Init()).detail);''',
'response_init': '''class Init { get status(): number { return 201; } get statusText(): string { return "made"; } }
const r = new Response("b", new Init()); console.log(r.status, r.statusText);''',
'request_init': '''class Init { get method(): string { return "PUT"; } }
console.log(new Request("http://localhost/x", new Init()).method);''',
'blob_options': '''class Options { get type(): string { return "text/x"; } }
console.log(new Blob(["a"], new Options()).type);''',
'text_decoder_options': '''class Options { get fatal(): boolean { return true; } }
console.log(new TextDecoder("utf-8", new Options()).fatal);''',
'readable_stream_source': '''class Source { n = 0; start(c: ReadableStreamDefaultController<string>): void { c.enqueue("s"); } pull(c: ReadableStreamDefaultController<string>): void { if (this.n++ < 1) c.enqueue("p"); else c.close(); } }
const out: string[] = []; for await (const chunk of new ReadableStream<string>(new Source())) out.push(chunk); console.log(out.join());''',
'transform_stream': '''class Upper { transform(chunk: string, c: TransformStreamDefaultController<string>): void { c.enqueue(chunk.toUpperCase()); } flush(c: TransformStreamDefaultController<string>): void { c.enqueue("end"); } }
const t = new TransformStream<string, string>(new Upper()); const w = t.writable.getWriter(); void w.write("a").then(() => w.close());
const out: string[] = []; for await (const chunk of t.readable) out.push(chunk); console.log(out.join());''',
'queuing_strategy': '''class Strategy { get highWaterMark(): number { return 3; } size(): number { return 1; } }
let wanted = 0; new ReadableStream<string>({ start(c) { wanted = c.desiredSize ?? -1; } }, new Strategy()); console.log(wanted);''',
'writable_stream_sink': '''class Sink { got: string[] = []; write(chunk: string): void { this.got.push(chunk); } close(): void { console.log("closed", this.got.join()); } }
const w = new WritableStream<string>(new Sink()).getWriter(); await w.write("a"); await w.write("b"); await w.close();''',
'structured_clone_options': '''class Options { get transfer(): ArrayBuffer[] { return []; } }
console.log(structuredClone({ a: 1 }, new Options()).a);''',
'read_file_options': '''import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
class Options { get encoding(): "utf8" { return "utf8"; } }
const p = join(mkdtempSync(join(tmpdir(), "w")), "f.txt"); writeFileSync(p, "text"); console.log(typeof readFileSync(p, new Options()));''',
'node_readable_options': '''import { Readable } from "node:stream";
class Options { n = 0; read(this: Readable): void { this.push(null); } get objectMode(): boolean { return true; } }
const r = new Readable(new Options()); console.log(r.readableObjectMode); r.resume(); await new Promise<void>(done => r.on("end", () => done())); console.log("ended");''',
'util_inspect_options': '''import { inspect } from "node:util";
class Options { get depth(): number { return 0; } }
console.log(inspect({ a: { b: { c: 1 } } }, new Options()));''',
'inspect_with_getters': '''import { inspect } from "node:util";
class C { get kappa(): string { return "kappa"; } }
console.log(inspect(Object.getPrototypeOf(new C()), { getters: true, showHidden: true }).includes("kappa"));''',
'event_emitter_options': '''import { EventEmitter } from "node:events";
class Options { get captureRejections(): boolean { return false; } }
console.log(typeof new EventEmitter(new Options()).on);''',
'abort_signal_listener_object': '''class Listener { handleEvent(): void { console.log("aborted"); } }
const c = new AbortController(); c.signal.addEventListener("abort", new Listener()); c.abort();''',
'bun_inspect_custom_is_a_symbol': '''class C { [Bun.inspect.custom](): string { return "custom"; } }
console.log(Bun.inspect(new C()));''',
'bun_file_options': '''class Options { get type(): string { return "text/y"; } }
console.log(Bun.file("/nonexistent-file", new Options()).type.split(";")[0]);''',
'headers_init': '''class Init { [name: string]: string; }
console.log(new Headers(new Init()).has("x"));''',
'url_search_params_iterable': '''class Pairs { *[Symbol.iterator](): Generator<[string, string]> { yield ["a", "1"]; } }
console.log(new URLSearchParams(new Pairs() as unknown as Iterable<[string, string]>).toString());''',
'performance_measure_options': '''class Options { get start(): number { return 0; } get duration(): number { return 5; } }
console.log(performance.measure("m", new Options()).duration);''',
'the_namespace_by_key': '''import * as all from "./lib_classes.ts";
const made: any = new (all as any)[glue("Hid", "den")](); console.log(made[glue("al", "pha")]());''',
'the_namespace_imported_by_value': '''const all: any = await import("./lib_classes.ts");
const made: any = new all[glue("Hid", "den")](); console.log(made[glue("al", "pha")]());''',
'handed_to_a_javascript_file': '''import { callByKey } from "./lib_untyped.js";
class C { alpha(): string { return "alpha"; } }
console.log(callByKey(new C(), glue("al", "pha")));''',
'an_heir_in_a_javascript_file': '''import { heirOf } from "./lib_untyped.js";
class C { alpha(): string { return "alpha"; } }
console.log(heirOf(C, glue("al", "pha")));''',
}
for f in os.listdir('.'):
    if re.match(r'^[wb]_.*\.ts$', f): os.remove(f)
for k, v in W.items(): open('w_%s.ts' % k, 'w').write('// %s\n' % k.replace('_', ' ') + HEAD + v + '\n')
for k, v in B.items():
    imports = ''.join(l + '\n' for l in v.split('\n') if l.startswith('import ')); rest = '\n'.join(l for l in v.split('\n') if not l.startswith('import '))
    open('b_%s.ts' % k, 'w').write('// %s\n' % k.replace('_', ' ') + imports + HEADB + rest + '\n')
open('lib_classes.ts', 'w').write('export class Hidden { alpha(): string { return "alpha of Hidden"; } }\nexport class Other { beta(): string { return "beta"; } }\n')
open('lib_untyped.js', 'w').write('export function callByKey(o, k) { return o[k](); }\nexport function heirOf(C, k) { class Heir extends C { } return new Heir()[k](); }\n')
open('lib_untyped.d.ts', 'w').write('export function callByKey(o: object, k: string): unknown;\nexport function heirOf(C: new () => object, k: string): unknown;\n')
print(len(W), 'for the shell,', len(B), 'for the whole Bun')
