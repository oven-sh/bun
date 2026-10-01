// usage: node make-inputs2.cjs > inputs2.json   the variants and the edges of the conditions that inputs.json found
const out = [];
const g = (group, list, l) => { for (const s of list) out.push(l ? { g: group, s, l } : { g: group, s }); };
g("a start of a heritage entry or of a decorator: isStartOfLeftHandSideExpression", [
  "class C extends +a {}", "class C extends ~a {}", "class C extends --a {}", "class C extends await a {}", "class C extends yield {}",
  "class C extends <T,>(a) => a {}", "class C extends new.target {}", "class C extends async function() {} {}", "class C extends async {}",
  "class C extends import {}", "class C extends import.meta.x {}", "class C extends function* () {} {}", "class C extends /=/ {}",
  "class C extends let {}", "class C extends static {}", "class C extends interface {}", "class C extends of {}", "class C extends type {}",
  "class C extends abstract {}", "class C extends in {}", "class C extends instanceof {}", "class C extends var {}", "class C extends if {}",
  "class C extends ) {}", "class C extends ; {}", "class C extends = {}", "class C extends => {}", "class C extends ... {}", "class C extends ?.a {}",
  "class C extends . {}", "class C extends * {}", "class C extends + {}", "class C extends true {}", "class C extends false {}", "class C extends 1n {}",
  "class C extends {a: 1} {}", "class C extends {}, B {}", "class C extends {} implements I {}", "class C extends {}.x {}", "class C extends {} extends B {}",
  "class C extends {}\n{}", "class C extends {", "class C extends { }", "class C extends {a} {}", "class C extends {a}",
  "class C implements {} {}", "class C implements {}, A {}", "class C implements {} extends B {}", "class C implements {a: string} {}", "class C implements A, {} {}",
  "class C implements +a {}", "class C implements !a {}", "class C implements await a {}", "class C implements <T>a {}", "class C implements #a {}",
  "class C implements super {}", "class C implements new A {}", "class C implements function() {} {}", "class C implements class {} {}",
  "class C implements a`b` {}", "class C implements a!.b {}", "class C implements A.B {}", "class C implements A.B.C<D, E> {}", "class C implements A<B<C>> {}",
  "class C implements A<B>>{}", "class C implements a.b?.c {}", "class C implements a[b] {}", "class C implements typeof a.b {}", "class C implements yield {}",
  "function* g() { class C implements yield {} }", "async function f() { class C implements await {} }", "class C implements async {}",
  "class C implements import {}", "class C implements of, type, abstract {}", "class C implements extends {}", "class C implements implements {}",
  "class C implements A extends {}", "class C extends A implements B extends C {}", "class C extends A extends B extends C {}",
  "@+a class C {}", "@!a class C {}", "@typeof a class C {}", "@<T>a class C {}", "@#a class C {}", "class C { @-a m() {} }", "class C { m(@-a x) {} }",
  "function* g() { @yield class C {} }", "@async () => {} class C {}", "@a.b?.c class C {}", "@(a, b) class C {}", "@a() class C {}", "@++a class C {}",
  "@void 0 class C {}", "@delete a.b class C {}", "@new A class C {}", "@a`b` class C {}", "@a! class C {}", "@a!.b class C {}", "@a<T>() class C {}",
  "@import('x') class C {}", "@{} class C {}", "@[a][0] class C {}", "@/a/ class C {}", "@'a' class C {}", "@1 class C {}", "@null class C {}",
  "@this class C {}", "@function f() {} class C {}", "@class {} class C {}", "@@a class C {}", "@a @-b class C {}",
  "interface I extends +a {}", "interface I extends !a {}", "interface I extends <T>a {}", "interface I extends #a {}", "interface I extends {} {}",
  "interface I extends {}, A {}", "interface I extends {a: 1}", "interface I extends readonly A[] {}", "interface I extends unique symbol {}",
  "interface I extends infer A {}", "interface I extends asserts x {}", "interface I extends x is A {}", "interface I extends new () => A {}",
  "interface I extends A.B.C<D> {}", "interface I extends A<B<C>> {}", "interface I extends a`b` {}", "interface I extends super {}",
  "interface I extends yield {}", "interface I extends await {}", "interface I extends any {}", "interface I extends A extends {}",
]);
g("a start of a heritage entry: JavaScript and TSX", ["class C extends -a {}", "class C extends typeof a {}", "class C extends await a {}", "@-a class C {}"], "js");
g("a start of a heritage entry: JavaScript and TSX", ["class C extends <div/> {}", "class C extends <T,>(a) => a {}", "class C implements <div/> {}", "class C extends -a {}"], "tsx");
g("d the token after the name of a member: ? and !", [
  "class C { get x!() { return 1 } }", "class C { set x?(v) {} }", "class C { static get x?() { return 1 } }", "class C { async m!() {} }", "class C { *m!() {} }",
  "class C { *m?() {} }", "class C { async m?() {} }", "class C { 'constructor'?() {} }", "class C { 'constructor'!() {} }", "class C { static constructor?() {} }",
  "class C { constructor?: number }", "class C { constructor! : number }", "class C { x!<T>() {} }", "class C { x?!() {} }", "class C { accessor x!() {} }",
  "class C { declare x!() }", "class C { x!(): void }", "class C { x!\n() {} }", "class C { x!;\n() {} }", "class C { [k]!() {} }", "class C { 1!() {} }",
  "class C { #x!() {} }", "class C { static x!() {} }", "abstract class C { abstract x!(): void }", "({ x!() {} })", "({ x?() {} })",
  "class C { x?() {} }", "class C { x?<T>() {} }", "class C { x?: number }", "class C { x!: number }", "class C { x? = 1 }", "class C { x! }", "class C { x!; }",
  "class C { x? }", "class C { x?\n y }", "class C { x!\n y }", "class C { x ! : number }", "class C { 'x'!: number }", "class C { [k]?: number }",
  "class C { get x?: number }", "class C { get x? }", "class C { set x! }", "class C { get x!: number }", "class C { static x?() {} }", "class C { static?() {} }",
  "class C { get?() {} }", "class C { get!() {} }", "class C { get?: number }", "class C { set!: number }", "class C { async?() {} }", "class C { async!: number }",
  "class C { constructor?(): void }", "declare class C { constructor?() }", "class C { public constructor?() {} }", "class C { constructor<T>?() {} }",
  "class C { accessor x?: number }", "class C { accessor x!: number }", "class C { readonly x?() {} }",
]);
g("e a modifier of a parameter and what follows it", [
  "class C { constructor(readonly\n x) {} }", "class C { constructor(public readonly\n x) {} }", "class C { constructor(public\n readonly x) {} }",
  "class C { constructor(private\n[x]) {} }", "class C { constructor(static\n x) {} }", "function f(public\n x) {}", "class C { constructor(public/*c*/x) {} }",
  "class C { constructor(public // c\n x) {} }", "class C { constructor(public 'a') {} }", "class C { constructor(public 1) {} }", "class C { constructor(public *) {} }",
  "class C { constructor(public = 1, y) {} }", "class C { constructor(public x, private y, protected z, readonly w, override v) {} }",
  "class C { constructor(override\n x) {} }", "class C { constructor(public,\n x) {} }", "class C { constructor(public\n, x) {} }", "class C { constructor(public\n) {} }",
  "class C { constructor(public\n: number) {} }", "class C { constructor(public\n = 1) {} }", "class C { constructor(public\n?) {} }", "class C { m(public\n x) {} }",
  "(public\n x) => 1", "class C { constructor(protected\n x: number) {} }", "class C { constructor(private\n private x) {} }",
  "class C { constructor(public readonly x) {} }", "class C { constructor(readonly public x) {} }", "class C { constructor(public public x) {} }",
  "class C { constructor(public {x}) {} }", "class C { constructor(public [x]) {} }", "class C { constructor(public ...x) {} }",
  "class C { constructor(...public) {} }", "class C { constructor(...public x) {} }", "class C { constructor(public this) {} }", "class C { constructor(public async) {} }",
  "class C { constructor(public public) {} }", "class C { constructor(public readonly) {} }", "class C { constructor(readonly public) {} }",
  "class C { constructor(public static) {} }", "class C { constructor(public x y) {} }", "class C { constructor(public x = 1, y) {} }",
]);
g("f an index signature after get, set or *, and [modifier name", [
  "class C { set [k: string]: any }", "class C { static get [k: string]: any }", "class C { async [k: string]: any }", "class C { async *[k: string]: any }",
  "class C { accessor [k: string]: any }", "class C { declare [k: string]: any }", "abstract class C { abstract [k: string]: any }", "class C { get [k]: any }",
  "class C { get [k: string] }", "class C { get [k: string]() { return 1 } }", "class C { get [k]() { return 1 } }", "class C { *[k]() {} }",
  "class C { *[k: string]() {} }", "class C { get [...k]: any }", "class C { get []: any }", "class C { *[] }", "class C { get [k?]: any }", "class C { get [k, j]: any }",
  "class C { get [k?]() { return 1 } }", "class C { set [k, j](v) {} }", "class C { static *[k: string]: any }", "class C { readonly get [k: string]: any }",
  "class C { [async x]: any }", "class C { [async x => x] = 1 }", "class C { [async x => x]() {} }", "class C { [static k]: any }", "class C { [abstract k]: any }",
  "class C { [in k]: any }", "class C { [out k]: any }", "class C { [const k]: any }", "class C { [export k]: any }", "class C { [default k]: any }",
  "class C { [declare k]: any }", "class C { [accessor k]: any }", "class C { [override k]: any }", "class C { [readonly k]: any }", "class C { [private k]: any }",
  "class C { [protected k: string]: any }", "class C { [public k, j]: any }", "class C { [public k?]: any }", "class C { [public]: any }", "class C { [public] = 1 }",
  "class C { [public k] = 1 }", "class C { [async () => {}]: any }", "class C { [await x]: any }", "class C { [yield x]: any }", "class C { [abstract]: any }",
  "class C { [async]: any }", "class C { [async, b]: any }", "class C { [async?]: any }", "class C { [async: string]: any }", "class C { [static]() {} }",
  "class C { [x y]: any }", "class C { [type x]: any }", "class C { [of x]: any }", "class C { [let x]: any }", "class C { [get x]: any }",
]);
g("f [async x => x] in JavaScript", ["class C { [async x => x] = 1 }", "class C { [async x => x]() {} }", "class C { [public] = 1 }"], "js");
g("g a binding property that is one reserved word", [
  "var {class} = x", "let {if} = x", "const {this} = x", "var {true} = x", "var {null} = x", "var {typeof} = x", "var {in} = x", "var {new} = x",
  "var {function} = x", "var {enum} = x", "var {yield} = x", "var {await} = x", "var {let} = x", "var {static} = x", "var {class = 1} = x", "var {class: a} = x",
  "function f({if}) {}", "try {} catch ({class}) {}", "for (var {class} of x) {}", "var [{class}] = x", "var {a: {class}} = x", "var {...class} = x",
  "var {...this} = x", "({class}) => 1", "({class} = x)", "var {class,} = x", "var {class}", "var {implements} = x", "var {interface} = x", "var {package} = x",
  "var {private} = x", "var {arguments} = x", "var {eval} = x", "var {of} = x", "var {async} = x", "var {type} = x", "var {super} = x", "var {import} = x",
  "var {export} = x", "var {default} = x", "var {void} = x", "var {delete} = x", "var {const} = x", "var {var} = x", "var {with} = x", "var {false} = x",
  "var {class()} = x", "var {class(){}} = x", "var {a()} = x", "var {get a(){}} = x", "var {a b} = x", "var {a,, b} = x", "var {'a'} = x", "var {1} = x",
  "var {[a]} = x", "var {#a} = x", "function* g() { var {yield} = x }", "async function f() { var {await} = x }",
]);
g("g a binding property that is one reserved word: JavaScript", ["var {class} = x", "function f({this}) {}", "var {enum} = x"], "js");
g("h an arrow parameter that is more than a binding", [
  "(a!) => 1", "(a as T) => 1", "(<T>a) => 1", "((a)) => 1", "(a satisfies T) => 1", "(a!, b) => 1", "async (a!) => 1", "([a!]) => 1", "({a: b!}) => 1",
  "(a! = 1) => 1", "((a), b) => 1", "((a) = 1) => 1", "([(a)]) => 1", "({a: (b)}) => 1", "(a as any as T) => 1", "(a!: T) => 1", "<T>(a!) => 1", "((a!)) => 1",
  "(...a!) => 1", "(...(a)) => 1", "([...a!]) => 1", "({...a!}) => 1", "([a as T]) => 1", "({a: b as T}) => 1", "({a = 1!}) => 1", "(a = b!) => 1",
  "(a = (b)) => 1", "(a = b as T) => 1", "([a = b!]) => 1", "({a: b = c!}) => 1", "(a!!) => 1", "((a) as T) => 1", "(a! as T) => 1", "async ((a)) => 1",
  "async (a as T) => 1", "async (<T>a) => 1", "((a, b)) => 1", "(a, (b)) => 1", "([a], (b)) => 1", "(((a))) => 1", "(a)! => 1", "(a) as T => 1",
  "((a)): void => 1", "(a!): void => 1", "((a)?: T) => 1", "(a?!) => 1", "(a!?) => 1",
]);
g("i other members that Bun reads in its own way", [
  "class C { get x() x }", "class C { get x(): number x }", "class C { set x(v) x }", "({ get x() x })", "class C { get x() => 1 }", "class C { 'constructor': number }",
  "class C { \"constructor\" }", "class C { constructor\n() {} }", "class C { constructor\n(): void }", "class C { static\nconstructor() {} }",
  "class C { constructor }", "class C { constructor\n x }", "class C { get constructor }", "class C { async constructor }", "class C { constructor<T> }",
  "class C { public\nconstructor() {} }", "class C { get\nconstructor() {} }", "class C { static *constructor() {} }", "class C { static get constructor() { return 1 } }",
  "class C { static async constructor() {} }", "class C { constructor() {} 'constructor'() {} }", "class C { ['constructor']: number }", "class C { static constructor: number }",
  "class C { static 1n = 1 }", "class C { static 1n() {} }", "class C { public 1n = 1 }", "class C { readonly 1n = 1 }", "class C { async 1n() {} }", "class C { set 1n(v) {} }",
  "class C { accessor 1n = 1 }", "class C { declare 1n: number }", "class C { *1n() {} }", "({ get 1n() { return 1 } })", "({ async 1n() {} })", "({ 1n: 1 })",
  "class C { 1n = 1 }", "class C { 1n() {} }", "class C { get 1() { return 1 } }", "class C { static 'a' = 1 }", "class C { get 0x1n() { return 1 } }",
]);
g("i members named by a bigint: JavaScript", ["class C { get 1n() { return 1 } }", "class C { static 1n() {} }", "({ get 1n() { return 1 } })", "({ async 1n() {} })"], "js");
process.stdout.write(JSON.stringify(out, null, 0));
