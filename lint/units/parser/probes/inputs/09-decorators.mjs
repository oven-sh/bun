// Group 09: decorators. Bun runs each input without tsconfig (standard decorators) and with
// experimentalDecorators + emitDecoratorMetadata; tsc runs a program for both settings.
import { list, template } from "./_lib.mjs";

const T = "src/js_parser/parse/parse_typescript.rs";
const S = "src/js_parser/parse/parse_stmt.rs";
const M = "src/js_parser/parse/mod.rs";
const F = "src/js_parser/parse/parse_fn.rs";
const PP = "src/js_parser/parse/parse_property.rs";
const R = "parser.go";

export const families = {
  expr: { bun: `${T}:35-68 parse_type_script_decorators (experimental: an expression at Level::New with EFlags::TsDecorator), ${T}:77-203 parse_standard_decorator (standard: name, members, one call, "(expr)", 190-198 type arguments)`, ref: `${R}:3948 parseDecorator, 3955 parseDecoratorExpression, 5195 parseLeftHandSideExpressionOrHigher` },
  classPos: { bun: `${S}:78-129 t_at (115-121 what may follow the decorators), ${S}:848-855 and :983-988 (after export and export default), src/js_parser/parse/parse_prefix.rs:596-665 pfx_t_at (class expression)`, ref: `${R}:1124 parseDeclaration, 3908 parseModifiersEx(allowDecorators), 5776 parseDecoratedExpression` },
  memberPos: { bun: `${M}:136-292 parse_class (the member loop reads decorators, then ${PP}:241 parse_property), ${PP}:280-285 private names under experimental decorators`, ref: `${R}:1894 parseClassElement, 3908 parseModifiersEx` },
  paramPos: { bun: `${F}:229-235 (only when opts.allow_ts_decorators), ${F}:286-303 (metadata is read only when a decorator was seen before this parameter)`, ref: `${R}:3364 parseParameterEx -> 3908 parseModifiersEx(allowDecorators = true)` },
  otherPos: { bun: `${S}:115-121 (a decorator before anything but a class is rejected with "Expected class")`, ref: `${R}:1124 parseDeclaration parses the modifiers first; the checker reports 1206` },
};

const exprs = [
  "@d", "@d()", "@d.e", "@d.e.f", "@d.e()", "@d.e.f()", "@d(1)", "@d(1, 2)", "@d(...a)", "@d({ a: 1 })", "@d(() => {})", "@d((a: A): B => c)", "@d(<T>(a: T) => a)", "@d(a as T)", "@d(<T>a)", "@d(a!)", "@d(class {})", "@d(function () {})", "@(d)", "@(d())", "@(d.e)", "@(d + e)", "@(d, e)", "@(d as any)", "@(<any>d)", "@(d!)", "@(d satisfies any)", "@(d?.e)", "@(d[0])", "@(d`e`)", "@(new D())", "@(await d)", "@(yield)", "@(() => {})", "@(function () {})", "@(class {})", "@((d))", "@()", "@(d",
  "@d!", "@d!.e", "@d.e!", "@d!()", "@d()!", "@d!!", "@d<T>", "@d<T>()", "@d.e<T>()", "@d<T>.e", "@d<T>.e()", "@d<T><U>()", "@d<>()", "@d<T,>()", "@d<T", "@d<T>(1)<U>", "@d()<T>", "@d()()", "@d().e", "@d().e()", "@d()[0]", "@d()`e`", "@d[0]", "@d[0]()", "@d.e[0]", "@d[\"e\"]", "@d[e]", "@d`e`", "@d.e`f`", "@d?.e", "@d?.()", "@d?.[0]", "@d.e?.f", "@d.#e", "@d.#e()", "@d.e.#f", "@#d", "@this", "@this.d", "@this.d()", "@super.d", "@super.d()", "@super()", "@new D", "@new D()", "@new D.E()", "@new.target", "@import.meta", "@import.meta.d", "@import(\"x\")", "@await d", "@yield d", "@typeof d", "@void d", "@delete d", "@-d", "@!d", "@++d", "@d++", "@d + e", "@d || e", "@d ? e : f", "@d = e", "@d, e", "@d as any", "@d satisfies any", "@<any>d", "@d => e", "@(d) => e", "@async () => {}", "@async", "@async()", "@function () {}", "@class {}", "@{}", "@[]", "@1", "@\"d\"", "@`d`", "@/d/", "@null", "@true", "@undefined",
  "@if", "@class", "@function", "@new", "@typeof", "@void", "@in", "@var", "@const", "@let", "@static", "@yield", "@await", "@type", "@as", "@of", "@declare", "@abstract", "@namespace", "@module", "@interface", "@enum", "@export", "@default", "@import", "@public", "@private", "@readonly", "@accessor", "@override", "@get", "@set", "@constructor", "@arguments", "@eval", "@d.if", "@d.class", "@d.new()", "@d.typeof", "@d.default", "@d.export", "@d.import", "@d.constructor", "@d.prototype", "@d.accessor", "@d.static",
  "@ d", "@\nd", "@d\n", "@d\n()", "@d\n.e", "@d.\ne", "@d\n<T>()", "@d\n!", "@d\n[0]", "@d\n`e`", "@/* c */ d", "@d /* c */", "@d // c\n", "@@d", "@d @e", "@d@e", "@d\n@e", "@d() @e()", "@d()@e()", "@d.e @f.g", "@d @e @f @g", "@", "@ @", "@;", "@,",
];

const exprOwners = {
  classDecl: D => `${D} class C {}`,
  classDeclNewline: D => `${D}\nclass C {}`,
  classExpr: D => `const c = ${D} class {};`,
  field: D => `class C { ${D} x; }`,
  fieldNewline: D => `class C { ${D}\nx; }`,
  method: D => `class C { ${D} m() {} }`,
  computed: D => `class C { ${D} [x]() {} }`,
  computedField: D => `class C { ${D} ["x"] = 1; }`,
  staticField: D => `class C { ${D} static x = 1; }`,
  param: D => `class C { m(${D} a) {} }`,
};

const classPos = [
  "@d class C {}", "@d export class C {}", "export @d class C {}", "@d export default class C {}", "export default @d class C {}", "@d export default class {}", "export default @d class {}", "@a export @b class C {}", "@a export default @b class C {}", "@a export @b default class C {}", "export @a default class C {}", "export @a export class C {}", "@a @b export class C {}", "export @a @b class C {}", "@a export\nclass C {}", "@a\nexport class C {}", "export\n@a class C {}", "export @a\nclass C {}",
  "@d abstract class C {}", "@d export abstract class C {}", "export @d abstract class C {}", "@d export default abstract class C {}", "export default @d abstract class C {}", "abstract @d class C {}", "export abstract @d class C {}", "@d abstract\nclass C {}", "@d\nabstract class C {}", "@d abstract", "@d abstract;", "@d abstract = 1", "@d abstract class C { abstract m(): void }", "@d abstract class C { @e abstract m(): void }", "@d abstract class C { @e abstract x: T }", "@d abstract class C { abstract @e m(): void }",
  "@d declare class C {}", "@d export declare class C {}", "@d declare abstract class C {}", "@d export declare abstract class C {}", "declare @d class C {}", "export declare @d class C {}", "export @d declare class C {}", "declare abstract @d class C {}", "@d declare\nclass C {}", "@d\ndeclare class C {}", "@d declare", "@d declare;", "@d declare x", "@d declare var x: T;", "@d declare function f(): void;", "@d declare namespace N {}", "@d declare enum E {}", "@d declare interface I {}", "@d declare type T = 1;", "@d declare module \"m\" {}", "@d declare global {}", "@d(() => { class D {} }) declare class C {}", "@d(function () { var a }) declare class C {}", "@d(class { m() {} }) declare class C {}", "@d(() => a) declare abstract class C { m(): void }", "@d declare class C { @e m(): void }", "@d declare class C { @e x: T }", "@d declare class C { m(@e a: A): void }", "declare class C { @e m(): void }", "declare class C { @e x: T }", "declare class C { m(@e a: A): void }",
  "const c = @d class {};", "const c = @d class C {};", "const c = @d() class {};", "const c = @d @e class {};", "const c = @d abstract class {};", "const c = @d\nclass {};", "(@d class {});", "f(@d class {});", "[@d class {}];", "({ a: @d class {} });", "x = @d class {};", "x || @d class {};", "new (@d class {})();", "export default (@d class {});", "const c = @d;", "const c = @d x;", "const c = @d function () {};", "const c = @d () => {};", "const c = @d export class {};", "const c = class @d {};", "const c = class C @d {};", "class @d C {}", "class C @d {}", "class C extends @d B {}", "class C extends (@d class {}) {}", "class C implements @d I {}",
  "@d class C<T> {}", "@d class C<T> extends B<T> implements I<T> {}", "@d<T>() class C {}", "@d<T> class C {}", "@d.e<T>() class C<U> {}", "@d\n@e\nclass C {}", "@d @e @f class C {}", "@d() @e() export default class C extends B {}", "@d class C { constructor(public a: A) {} }", "@d class C { constructor(@e public a: A) {} }", "@d class C { constructor(@e a: A, @f() b: B) {} }", "@d class C { constructor(a: A, @e b: B) {} }", "@d class C { constructor(@e a: A, b: B) {} }", "@d class C { constructor(); constructor(@e a?: A) {} }", "@d class C { constructor(@e a: A); constructor(a: any) {} }",
];

const members = [
  "@d x;", "@d x: T;", "@d x = 1;", "@d x: T = 1;", "@d x?: T;", "@d x!: T;", "@d static x: T;", "static @d x: T;", "@d public x: T;", "public @d x: T;", "@d private x: T;", "@d protected x: T;", "@d readonly x: T;", "readonly @d x: T;", "@d public readonly x: T;", "public @d readonly x: T;", "public readonly @d x: T;", "@d public static readonly x: T;", "@d override x: T;", "@d declare x: T;", "declare @d x: T;", "@d abstract x: T;", "abstract @d x: T;", "@d accessor x: T;", "accessor @d x: T;", "@d static accessor x = 1;", "@d accessor x = 1;", "@d accessor #x = 1;", "@d static accessor #x = 1;", "@d accessor [x] = 1;", "@d accessor \"x\" = 1;", "@d accessor\nx = 1;", "@d accessor;", "@d accessor = 1;", "@d accessor() {}", "@d accessor x() {}", "@d accessor static x;",
  "@d \"x\": T;", "@d 1: T;", "@d 1n: T;", "@d [x]: T;", "@d [\"x\"]: T;", "@d [x.y]: T;", "@d [Symbol.iterator]() {}", "@d #x: T;", "@d #x = 1;", "@d #m() {}", "@d static #x = 1;", "@d static #m() {}", "@d get #x() { return 1 }", "@d set #x(v) {}", "@d [k: string]: T;", "@d static [k: string]: T;", "@d readonly [k: string]: T;",
  "@d m() {}", "@d m(): void {}", "@d m<T>(a: T): T { return a }", "@d m?() {}", "@d static m() {}", "@d async m() {}", "@d *m() {}", "@d async *m() {}", "@d static async *m() {}", "async @d m() {}", "@d public m() {}", "@d public static async m() {}", "@d override m() {}", "@d abstract m(): void;", "@d declare m(): void;", "@d m(): void;", "@d m(): void; m() {}", "m(): void; @d m() {}", "@d m(): void; @d m() {}", "@d m();", "@d m(a: A): void; @e m(a: B): void; m(a: any) {}",
  "@d get x() { return 1 }", "@d set x(v) {}", "@d get x(): T { return 1 }", "@d set x(v: T) {}", "@d static get x() { return 1 }", "@d static set x(v) {}", "get @d x() { return 1 }", "set @d x(v) {}", "@d get x() { return 1 } @d set x(v) {}", "@d get x() { return 1 } set x(v) {}", "get x() { return 1 } @d set x(v) {}", "@d get\nx() { return 1 }", "@d get;", "@d get: T;", "@d get() {}", "@d set;", "@d set: T;", "@d set(v) {}", "@d static;", "@d static: T;", "@d static() {}", "@d async;", "@d async: T;", "@d async() {}", "@d readonly;", "@d readonly: T;", "@d public;", "@d public() {}", "@d declare;", "@d declare: T;", "@d abstract;", "@d abstract() {}", "@d override;", "@d constructor;", "@d \"constructor\"() {}",
  "@d constructor() {}", "@d constructor(a: A) {}", "@d constructor();", "@d static {}", "@d static { x }", "static @d {}", "@d;", "@d", "@d }", "@d @e", "@d @e x;", "@d\n@e\nx;", "@d() @e() x;", "@d @e static @f x;", "@d x; @e y;", "@d x @e y", "@d x\n@e y", "@d x = 1 @e y = 2", "@d x = 1\n@e y = 2", "@d m() {} @e n() {}", "x @d;", "x @d = 1;", "x: @d T;", "x = @d 1;", "m @d () {}", "m() @d {}", "m(): @d void {}", "@d = 1;", "@d: T;", "@d() {}", "@d<T>() {}", "@d<T>() x;", "@d<T> x;", "@d! x;", "@d!.e x;", "@(d) x;", "@(d)() {}", "@(d)\n() {}", "@(d) [x];", "@d [x];", "@d\n[x];", "@d [x] = 1;", "@d[x];", "@d[x] y;", "@d [x]() {}", "@d[x]() {}", "@d.e [x]() {}", "@d() [x]() {}", "@d()[x]() {}", "@d `x`;", "@d *[x]() {}", "@d async [x]() {}", "@d get [x]() { return 1 }", "@d static [x]() {}", "@d (x);", "@d (x) y;", "@d (x) {}",
];

const params = [
  "@d a", "@d a: A", "@d() a: A", "@d @e a: A", "@d a?: A", "@d a = 1", "@d a: A = 1", "@d ...a: A[]", "...@d a: A[]", "@d ...a", "@d { a }: A", "@d [a]: A", "@d { a } = {}", "@d this: A", "@d this", "this: A, @d a: B", "@d public a: A", "public @d a: A", "@d readonly a: A", "readonly @d a: A", "@d public readonly a: A", "public @d readonly a: A", "@d private a", "@d protected a?: A", "@d override a: A", "a: A, @d b: B", "@d a: A, b: B", "@d a: A, @e b: B", "a: A, b: B, @d c: C", "a: A | B extends C ? D : E, @d b: B", "@d a: A | B extends C ? D : E", "@d a: keyof A extends B ? C : D", "@d a: A extends B ? C : D | E", "@d a: (A)", "@d a: a is B", "@d a,", "@d", "@d,", "@d: A", "@d = 1", "a @d", "a: @d A", "a = @d 1", "@d.e a", "@d.e() a", "@(d) a", "@d<T>() a", "@d! a", "@d\na: A", "@d a\n: A", "@d yield", "@d await", "@d static", "@d public", "@d readonly", "@d type", "@d async", "@d @e", "@@d a", "@d a b", "@d(@e a) b", "@d((@e a) => a) b", "@d(function (@e a) {}) b", "@d(class { m(@e a) {} }) b",
];

const paramOwners = {
  method: P => `class C { m(${P}) {} }`,
  decoratedMethod: P => `class C { @x m(${P}) {} }`,
  staticMethod: P => `class C { static m(${P}) {} }`,
  ctor: P => `class C { constructor(${P}) {} }`,
  decoratedClassCtor: P => `@x class C { constructor(${P}) {} }`,
  setter: P => `class C { set p(${P}) {} }`,
  overload: P => `class C { m(${P}): void; m(...a: any[]) {} }`,
  abstractMethod: P => `abstract class C { abstract m(${P}): void; }`,
  declareMethod: P => `declare class C { m(${P}): void; }`,
  classExprMethod: P => `const c = class { m(${P}) {} };`,
  privateMethod: P => `class C { #m(${P}) {} }`,
  fn: P => `function f(${P}) {}`,
  fnExpr: P => `const f = function (${P}) {};`,
  arrow: P => `const f = (${P}) => 0;`,
  objMethod: P => `const o = { m(${P}) {} };`,
  fnType: P => `let x: (${P}) => void;`,
  methodSig: P => `interface I { m(${P}): void }`,
  declareFn: P => `declare function f(${P}): void;`,
};

const otherPos = [
  "@d function f() {}", "@d async function f() {}", "@d function* f() {}", "@d var x;", "@d let x;", "@d const x = 1;", "@d using x = y;", "@d enum E {}", "@d const enum E {}", "@d interface I {}", "@d type T = 1;", "@d namespace N {}", "@d module N {}", "@d import x from \"y\";", "@d import type x from \"y\";", "@d import x = y.z;", "@d export {};", "@d export { x };", "@d export * from \"x\";", "@d export default 1;", "@d export default x;", "@d export default function f() {}", "@d export default function () {}", "@d export default interface I {}", "@d export default abstract class C {}", "@d export const x = 1;", "@d export function f() {}", "@d export enum E {}", "@d export interface I {}", "@d export type T = 1;", "@d export namespace N {}", "@d export = x;", "@d export as namespace X;", "@d export import a = b.c;", "@d export declare const x: T;", "@d x;", "@d x = 1;", "@d x();", "@d (x);", "@d { }", "@d if (a) {}", "@d for (;;) {}", "@d return;", "@d label: x;", "@d ;", "@d", "@d\n", "@d class", "@d class {}", "@d export", "@d export default", "@d export default class", "@d export class", "@d async", "@d abstract function f() {}", "@d declare function f(): void;",
  "function f() { @d class C {} }", "function f() { @d export class C {} }", "if (a) @d class C {}", "if (a) { @d class C {} }", "{ @d class C {} }", "for (;;) @d class C {}", "label: @d class C {}", "class C { static { @d class D {} } }", "() => { @d class C {} }", "switch (a) { case 1: @d class C {} }", "namespace N { @d class C {} }", "namespace N { @d export class C {} }", "namespace N { export @d class C {} }", "namespace N { @d abstract class C {} }", "namespace N { @d declare class C {} }", "declare namespace N { @d class C {} }", "declare module \"m\" { @d class C {} }", "declare module \"m\" { @d export class C {} }", "declare module \"m\" { @d export default class C {} }", "declare global { @d class C {} }",
  "interface I { @d m(): void }", "interface I { @d x: T }", "interface I { m(@d a: A): void }", "type T = { @d x: A }", "type T = { m(@d a: A): void }", "type T = (@d a: A) => void", "type T = new (@d a: A) => B", "type T = @d A", "let x: @d A", "enum E { @d A }", "enum E { A = @d 1 }", "const o = { @d m() {} };", "const o = { @d x: 1 };", "const o = { m(@d a) {} };", "const o = { @d get x() { return 1 } };", "function f(@d a) {}", "function f(@d a: A): void;", "function f(a, @d b) {}", "const f = (@d a) => 0;", "const f = (@d a: A): void => {};", "const f = async (@d a) => 0;", "const f = @d => 0;", "const f = function (@d a) {};", "const f = function* (@d a) {};", "class C { m() { @d x } }", "class C { m() { @d class D {} } }", "class C { x = @d class {} }", "class C { [@d class {}] = 1 }", "class C { @d([@e class {}]) x }", "try {} catch (@d e) {}", "for (@d const x of y) {}", "for (const @d x of y) {}", "var @d x;", "let { @d a } = b;", "let [@d a] = b;",
];

const cases = [];
for (const [ctx, make] of Object.entries(exprOwners)) cases.push(...template("expr", exprs, make, ctx));
cases.push(...list("classPos", classPos));
cases.push(...template("memberPos", members, X => `class C { ${X} }`, "class"));
cases.push(...template("memberPos", members, X => `abstract class C { ${X} }`, "abstractClass"));
cases.push(...template("memberPos", members, X => `declare class C { ${X} }`, "declareClass"));
cases.push(...template("memberPos", members, X => `const c = class { ${X} };`, "classExpr"));
cases.push(...template("memberPos", members, X => `@x class C { ${X} }`, "decoratedClass"));
for (const [ctx, make] of Object.entries(paramOwners)) cases.push(...template("paramPos", params, make, ctx));
cases.push(...list("otherPos", otherPos));

export default { name: "decorators", families, cases, programs: ["ts"], decoProgram: true };
