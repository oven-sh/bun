#!/usr/bin/env bun
// Class members, modifiers, overloads, parameter properties, heritage clauses.
// Reference: parseClassDeclarationOrExpression 1747, parseHeritageClauses 1824, parseExpressionWithTypeArguments 1884,
// parseClassElement 1894, tryParseConstructorDeclaration 1966, parsePropertyOrMethodDeclaration 1987,
// parsePropertyDeclaration 2015, parseAccessorDeclaration 3476, parseModifiersEx 3908, nextTokenCanFollowModifier 4009,
// isIndexSignature 3558, parseFunctionBlockOrSemicolon 3530.
import { each, writeGroup } from "./gen-lib.mjs";

const modifiers = ["public", "private", "protected", "static", "readonly", "abstract", "override", "declare", "accessor", "async"];
const memberNames = ["a", '"a"', "1", "[a]", "#a"];

// One class member. The class is abstract, so that "abstract" members are in place.
const membersBase = [
  "a", "a;", "a: A", "a: A;", "a = 1", "a: A = 1", "a?: A", "a?", "a? = 1", "a?: A = 1", "a!: A", "a!", "a! = 1", "a!: A = 1",
  "a?!: A", "a!?: A", "a\n!: A", "a\n?: A", "a: A\nb: B", "a: A b: B", "a: A, b: B", "a, b", "a = 1, b = 2", "a = 1; b = 2",
  "a = 1\nb = 2", "a\nb", "a b", "a: A;;", ";", ";;", "a():", "a(): void {}", "a() {}", "a(b: B): C { return b }", "a<T>(b: T): T { return b }",
  "a?() {}", "a?(): void {}", "a?(): void", "a?<T>(): void {}", "a!() {}", "a(): void", "a(): void;", "a();", "a()",
  "a(): void; a(b?: any) {}", "a(): void\na(b?: any) {}", "a(): void a() {}", "a(); a() {}", "a();\na();\na() {}", "a(): void; b() {}",
  "a(): void; a(): void;", "a(b: B): void; a(b: B, c: C): void; a(b: any, c?: any) {}", "a?(): void; a?() {}",
  "async a(): Promise<void> {}", "async a(): Promise<void>; async a(b?: any) {}", "*a(): Generator {}", "*a(): any; *a() {}",
  "async *a(): AsyncGenerator {}", "async *a(): any; async *a() {}", "static a(): void; static a(b?: any) {}",
  "#a(): void; #a(b?: any) {}", '"a"(): void; "a"(b?: any) {}', "[a](): void; [a](b?: any) {}", "1(): void; 1(b?: any) {}",
  "constructor() {}", "constructor();", "constructor(); constructor(a?: any) {}", "constructor(a: A); constructor(a: A, b: B); constructor(a: any, b?: any) {}",
  "constructor()\nconstructor(a?: any) {}", "constructor(): void {}", "constructor<T>() {}", "constructor(this: A) {}",
  "constructor?() {}", "constructor!() {}", "constructor: A", "constructor = 1", "constructor", "constructor;", "constructor?: A",
  '"constructor"() {}', "'constructor'(); 'constructor'(a?: any) {}", '"constructor"<T>() {}', '["constructor"]() {}',
  '"constructor": A', "#constructor", "#constructor() {}", "*constructor() {}", "async constructor() {}", "get constructor() { return 1 }",
  "set constructor(v) {}", "static constructor() {}", "static constructor", "static constructor: A", "constructor() {} constructor() {}",
  "get a(): A { return 1 }", "set a(v: A) {}", "get a() { return 1 } set a(v) {}", "get a(): A; ", "set a(v: A);", "get a();",
  "get a<T>() { return 1 }", "set a<T>(v) {}", "set a(v: A): void {}", "set a(v?: A) {}", "set a(...v: A[]) {}", "set a(v: A = 1) {}",
  "set a(v = 1) {}", "get a(v) { return 1 }", "set a() {}", "set a(v, w) {}", "set a({ b }: A) {}", "set a([b]: A) {}", "set a(this: A, v) {}",
  "get a(this: A) { return 1 }", "get a?() { return 1 }", "get a!() { return 1 }", "get: A", "get = 1", "get() {}", "get<T>() {}",
  "get?: A", "get!: A", "get;", "get", "get\na() {}", "set\na(v) {}", "get\n*a() {}", "get *a() {}", "get async a() {}", "async get a() {}",
  "get async() { return 1 }", "get static() { return 1 }", "get get() { return 1 }", "get set() { return 1 }", "set get(v) {}",
  'get "a"(): A { return 1 }', "get 1(): A { return 1 }", "get [a](): A { return 1 }", "get #a(): A { return 1 }", "get a: A",
  "[k: string]: A", "[k: string]: A;", "[k: number]: A", "[k: string]", "[k: string]: A = 1", "[k: string]?: A", "[k?: string]: A",
  "[...k: string[]]: A", "[k: string, l: number]: A", "[k: string,]: A", "[k, l]: A", "[k]: A", "[k] = 1", "[k]", "[k]?: A",
  "[k]!: A", "[k: string]() {}", "[k](): A {}", "[a.b]: A", "[Symbol.iterator](): A {}", '["a" + "b"]: A', "[a as B]: A", "[a!]: A",
  "[k: string]: A; [l: number]: B", "[public k: string]: A", "[k = 1]: A", "[this: string]: A", "[]: A", "[a, b]: A", "[a in b]: A",
  "[k: A<B>]: C", "[k: string]: A<B>", "[k: string]: () => void", "[k: string]: A | B\na: C",
  "static {}", "static { let a: A = 1; }", "static {} static {}", "static\n{}", "static { await a }", "static { return }",
  "static { this.a as A }", "static { var v = <T>(a: T) => a }", "static", "static;", "static = 1", "static: A", "static?: A",
  "static!: A", "static() {}", "static<T>() {}", "static?() {}", "static a", "static a: A = 1", "static\na", "static static",
  "static static a", "static static: A", "static static() {}", "static static static", "static async", "static async a() {}",
  "static async *a() {}", "static get", "static get a() { return 1 }", "static set a(v) {}", "static readonly", "static readonly a",
  "static *a() {}", "static #a", "static #a() {}", "static [a]", 'static "a"', "static 1", "static in", "static a = b in c",
  "async", "async;", "async = 1", "async: A", "async?: A", "async() {}", "async<T>() {}", "async a() {}", "async\na() {}", "async *a() {}",
  "async a", "async a: A", "async a = 1", "async async() {}", "async get() {}", "async static() {}", "async #a() {}", "async [a]() {}",
  'async "a"() {}', "async 1() {}", "async a<T>(b: T): Promise<T> { return b }", "async *a<T>(): AsyncGenerator<T> {}",
  "accessor", "accessor;", "accessor = 1", "accessor: A", "accessor?: A", "accessor() {}", "accessor<T>() {}", "accessor a",
  "accessor a = 1", "accessor a: A", "accessor a: A = 1", "accessor a?: A", "accessor a!: A", "accessor\na", "accessor a() {}",
  'accessor "a"', "accessor 1", "accessor [a]", "accessor #a", "accessor #a: A = 1", "accessor accessor", "accessor static a",
  "accessor readonly a", "accessor get a() { return 1 }", "accessor async a() {}", "accessor *a() {}", "accessor constructor",
  "declare", "declare;", "declare = 1", "declare: A", "declare?: A", "declare() {}", "declare<T>() {}", "declare a", "declare a: A",
  "declare a: A;", "declare a = 1", "declare a: A = 1", "declare a?: A", "declare a!: A", "declare\na", "declare a() {}", "declare a(): void",
  "declare a(): void;", "declare get a(): A", "declare get a() { return 1 }", "declare set a(v)", "declare #a: A", "declare #a",
  'declare "a": A', "declare 1: A", "declare [a]: A", "declare constructor()", "declare constructor() {}", "declare [k: string]: A",
  "declare static {}", "declare declare", "declare declare a", "declare async a() {}", "declare *a() {}", "declare accessor a",
  "abstract", "abstract;", "abstract = 1", "abstract: A", "abstract?: A", "abstract() {}", "abstract<T>() {}", "abstract a", "abstract a;",
  "abstract a: A", "abstract a: A;", "abstract a = 1", "abstract a: A = 1", "abstract a?: A", "abstract a!: A", "abstract\na",
  "abstract a(): void", "abstract a(): void;", "abstract a();", "abstract a() {}", "abstract a(): void {}", "abstract a?(): void",
  "abstract a<T>(b: T): T", "abstract a(): void; abstract a(b: B): void;", "abstract a(): void\nabstract b(): void", "abstract a(): void b() {}",
  "abstract get a(): A", "abstract get a(): A;", "abstract set a(v: A)", "abstract set a(v: A);", "abstract get a() { return 1 }",
  "abstract get a(): A; abstract set a(v: A);", "abstract #a", "abstract #a(): void", 'abstract "a": A', "abstract 1(): void",
  "abstract [a]: A", "abstract [a](): void", "abstract constructor()", "abstract constructor() {}", "abstract [k: string]: A",
  "abstract static {}", "abstract abstract", "abstract abstract a", "abstract async a()", "abstract async a(): Promise<void>;",
  "abstract *a()", "abstract *a(): any;", "abstract accessor a: A", "abstract accessor a",
  "override", "override;", "override = 1", "override: A", "override() {}", "override a", "override a: A", "override a() {}",
  "override a(): void; override a(b?: any) {}", "override\na", "override get a() { return 1 }", "override set a(v) {}",
  "override async a() {}", "override *a() {}", "override #a", "override [a]() {}", 'override "a"() {}', "override constructor() {}",
  "override [k: string]: A", "override static {}", "override override a", "override accessor a",
  "readonly", "readonly;", "readonly = 1", "readonly: A", "readonly?: A", "readonly() {}", "readonly<T>() {}", "readonly a", "readonly a: A",
  "readonly a = 1", "readonly a?: A", "readonly a!: A", "readonly\na", "readonly a() {}", "readonly get a() { return 1 }", "readonly #a",
  "readonly [a]", 'readonly "a"', "readonly 1", "readonly constructor() {}", "readonly [k: string]: A", "readonly static {}",
  "readonly readonly", "readonly readonly a", "readonly async a() {}", "readonly *a() {}", "readonly accessor a",
  "in: A", "instanceof: A", "if: A", "class: A", "new: A", "new() {}", "new<T>() {}", "delete() {}", "typeof: A", "void: A", "function() {}",
  "var: A", "enum: A", "type: A", "type = 1", "type a", "of: A", "as: A", "is: A", "infer: A", "keyof: A", "any: A", "string: A",
  "namespace: A", "module: A", "interface: A", "implements: A", "package: A", "let: A", "yield: A", "await: A", "this: A", "null: A",
  "true: A", "import: A", "export: A", "default: A", "extends: A", "super: A", "const: A", "const a", "const a = 1", "var a", "let a",
  "function a() {}", "export a", "default a", "in a", "out a", "const", "interface I {}", "type X = A", "enum E {}", "namespace N {}",
  "a: A = <A>b", "a = <T>(b: T) => b", "a = <T,>(b: T) => b", "a = (b: B): C => b", "a: () => void", "a: () => void = () => {}",
  "a: (b: B) => C = d", "a: A<B>=c", "a: A<B<C>>=d", "a?: A<B>", "a!: A<B>", "a: A<B>\nb: C", "a: typeof b", "a: typeof b\nc: C",
  "a: A | B = c", "a: A extends B ? C : D = e", "a: new () => A = b", "a: { b: B }", "a: { b: B } = { b: 1 }", "a: [A] = [1]",
  "a: A[] = []", "a: asserts b", "a: b is C", "a: this", "a: void", "a: unique symbol", "static readonly a: unique symbol",
  "a: A\n[b]: B", "a: A\n(b): B", "a: A\n<T>(b: T): T {}", "a: A\n*b() {}", "a: A\nget b() { return 1 }", "a: A\nstatic b", "a = 1\n[b] = 2",
  "a = 1\n*b() {}", "a = b\n(c)", "a\n(b) {}", "a\n<T>() {}", "a: A.B\n<T>() {}", "a =", "a:", "a: A =", "a?:", "a() { }; b() { }",
  "a(b: B) { b as C; <C>b; b!; }", "a = b as C", "a = b!", "a = b satisfies C", "a = b<C>", "a = b<C>(d)",
];

const combos = [];
for (const m1 of modifiers) {
  for (const n of memberNames) combos.push(`${m1} ${n}`);
  for (const m2 of modifiers) {
    combos.push(`${m1} ${m2} a`);
    combos.push(`${m1} ${m2} a() {}`);
    combos.push(`${m1} ${m2}`);
  }
}
for (const m1 of ["public", "private", "protected"]) {
  for (const rest of ["static readonly a", "static override a", "override readonly a", "static override readonly a", "abstract readonly a", "abstract override a", "static async a() {}", "static async *a() {}", "static get a() { return 1 }", "static accessor a", "declare readonly a", "static declare readonly a", "override async a() {}", "abstract override readonly a: A"]) {
    combos.push(`${m1} ${rest}`);
  }
}

const heritageLists = [
  "A", "A<B>", "A.B", "A.B<C>", "A<B<C>>", "A, B", "A<B>, C<D>", "A,", ",A", "A,,B", "", "A B", "A[]", "A[B]", "A[0]", "A | B", "A & B",
  "(A)", "(A)<B>", "(A as any)", "(A as any)<B>", "typeof a", "keyof A", "A extends B ? C : D", "{}", "{ a: A }", "[A]", "() => void",
  "new () => A", "string", "void", "null", "undefined", "this", "this.A", "super", "1", '"s"', "`t`", "A<B>.C", "A<>", "A<B,>", "A?.B",
  "A?.()", "A!", "A!.B", "A<B>!", "A()", "A()<B>", "A<B>()", "A<B>()<C>", "A.B()", 'A["b"]', "A`t`", "A<B>`t`", "new A", "new A()",
  "new A<B>()", "A as B", "A satisfies B", "a ? B : C", "A || B", "A.#b", "A.class", "A.default", "class {}", "class B {}",
  "class<T> {}", "function () {}", "function <T>() {}", "import('m')", "import.meta", "async", "async () => {}", "await A", "yield A",
  "type", "of", "any", "object", "A\n<B>", "A<B>\n<C>", "A.\nB", "A<B<C<D>>>", "A<B>>", "f(A)<B>", "f<A>(B)<C>", "mixin(A, B)",
  "mixin<A>(B)", "A<(b: B) => C>", "A<{ b: B }>", "A<typeof b>", "A<B | C>", "A<B[]>", "A<B extends C ? D : E>",
];

const classForms = [
  "class C {}", "class C<T> {}", "class C extends D {}", "class C extends D implements I {}", "class C implements I {}",
  "class C implements I extends D {}", "class C extends D extends E {}", "class C implements I implements J {}",
  "class C extends D implements I extends E {}", "class C extends D, E {}", "class C<T> extends D<T> implements I<T>, J<T> {}",
  "class C extends {}", "class C implements {}", "class C extends implements I {}", "class C implements extends D {}",
  "class implements I {}", "class implements {}", "class extends D {}", "class implements implements I {}",
  "class C extends D<T>", "class C extends D<T> {", "class C\nextends D\nimplements I\n{}", "class C implements\nI {}",
  "abstract class C {}", "abstract\nclass C {}", "abstract class\nC {}", "export abstract class C {}", "export default abstract class C {}",
  "export default abstract class {}", "export default abstract class extends D {}", "export default abstract class implements I {}",
  "declare class C {}", "declare abstract class C {}", "abstract declare class C {}", "export declare abstract class C {}",
  "abstract abstract class C {}", "var v = abstract class {};", "var v = (abstract class {});", "abstract;", "abstract = 1;",
  "abstract();", "abstract\n();", "abstract.a;", "abstract\nclass\nC {}", "var abstract = 1;", "abstract + 1;", "abstract class C",
  "abstract function f() {}", "abstract const a = 1;", "abstract var a;", "abstract enum E {}", "abstract namespace N {}",
  "abstract type X = 1;", "async class C {}", "static class C {}", "public class C {}", "private class C {}", "readonly class C {}",
  "const class C {}", "override class C {}", "accessor class C {}", "export public class C {}", "export static class C {}",
  "var v = class<T> {};", "var v = class C<T> extends D<T> implements I {};", "(class implements I {});", "(class C implements I, J {});",
  "var v = class extends D<T> {};", "var v = class implements I {};", "new (class<T> implements I {})();", "class C { }\nclass D { }",
  "class type {}", "class as {}", "class of {}", "class is {}", "class async {}", "class await {}", "class yield {}", "class let {}",
  "class static {}", "class public {}", "class implements {}", "class interface {}", "class package {}", "class abstract {}",
  "class declare {}", "class readonly {}", "class any {}", "class string {}", "class number {}", "class object {}", "class undefined {}",
  "class unknown {}", "class never {}", "class namespace {}", "class module {}", "class global {}", "class require {}", "class constructor {}",
  "class get {}", "class set {}", "class from {}", "class using {}", "class accessor {}", "class override {}", "class keyof {}",
  "class infer {}", "class unique {}", "class asserts {}", "class out {}", "class satisfies {}", "class arguments {}", "class eval {}",
];

const thisParams = [
  "function f(this: A) {}", "function f(this) {}", "function f(this: A, a: B) {}", "function f(this, a) {}", "function f(a, this: A) {}",
  "function f(this: A, ...a: B[]) {}", "function f(this,) {}", "function f(this: A,) {}", "function f(this?: A) {}", "function f(this = 1) {}",
  "function f(this: A = 1) {}", "function f(...this) {}", "function f(this: A, this: B) {}", "function f(@d this) {}",
  "function f(public this) {}", "function f(this: this) {}", "function f(this: void) {}", "function f(this: A<B>) {}",
  "function f(this: () => void) {}", "function f({ this: a }) {}", "function f([this]) {}", "function f(this.a) {}",
  "function f(this\n: A) {}", "function* f(this: A) {}", "async function f(this: A) {}", "var v = function (this: A) {};",
  "var v = function (this: A, a: B): C {};", "var v = (this: A) => 1;", "var v = (this) => 1;", "var v = (this: A, a: B) => 1;",
  "var v = async (this: A) => 1;", "var v = { m(this: A) {} };", "var v = { m(this: A, a: B) {} };", "var v = { get a(this: A) { return 1 } };",
  "var v = { set a(this: A, v) {} };", "class C { m(this: C) {} }", "class C { m(this: C, a: A) {} }", "class C { m(this) {} }",
  "class C { m(a, this: C) {} }", "class C { static m(this: A) {} }", "class C { constructor(this: A) {} }", "class C { get a(this: A) { return 1 } }",
  "class C { set a(this: A, v) {} }", "class C { m(this: this) {} }", "class C { m(this: C): void; m(this: C, a?: any) {} }",
  "class C { @d m(this: C, a: A) {} }", "class C { m(@d this: C) {} }", "declare function f(this: A): void;", "declare function f(this: A, a: B): void;",
  "type X = (this: A) => void;", "type X = (this: A, a: B) => void;", "type X = new (this: A) => B;", "type X = { m(this: A): void };",
  "type X = { (this: A): void };", "type X = { new (this: A): B };", "interface I { m(this: I): void }",
];

const wrap = m => `abstract class C extends B {\n  ${m}\n}`;
const plain = m => `class C {\n  ${m}\n}`;

writeGroup("06-class-members-modifiers-overloads.txt", "Class members, modifiers, overloads, parameter properties.", [
  { prefix: "member", kind: "file", items: each(membersBase, wrap) },
  { prefix: "member.expr", kind: "file", items: each(membersBase.slice(0, 110), m => `var v = class {\n  ${m}\n};`) },
  { prefix: "member.declare", kind: "file", items: each(membersBase, m => `declare abstract class C extends B {\n  ${m}\n}`) },
  { prefix: "member.nonabstract", kind: "file", items: each(membersBase.filter(m => /abstract/.test(m)), plain) },
  { prefix: "modifier", kind: "file", items: each(combos, wrap) },
  { prefix: "extends", kind: "file", items: each(heritageLists, h => `class C extends ${h} {}`) },
  { prefix: "extends.expr", kind: "file", items: each(heritageLists, h => `var v = class extends ${h} {};`) },
  { prefix: "implements", kind: "file", items: each(heritageLists, h => `class C implements ${h} {}`) },
  { prefix: "extends.implements", kind: "file", items: each(heritageLists, h => `class C extends D implements ${h} {}`) },
  { prefix: "class", kind: "file", items: classForms },
  { prefix: "this", kind: "file", items: thisParams },
  {
    prefix: "overload",
    kind: "file",
    items: [
      "function f(): void; function f(a?: any) {}", "function f(): void\nfunction f(a?: any) {}", "function f(): void function f() {}",
      "function f(): void;", "function f();", "function f()", "function f(): void\n", "function f(a: A): void; function f(a: B): void; function f(a: any) {}",
      "function f(): void; function g() {}", "function f(): void; var a = 1; function f() {}", "export function f(): void; export function f(a?: any) {}",
      "export function f(): void;", "export default function f(): void; export default function f(a?: any) {}",
      "export default function (): void; export default function (a?: any) {}", "export default function f(): void;",
      "export default function (): void;", "async function f(): Promise<void>; async function f(a?: any) {}", "function* f(): any; function* f() {}",
      "declare function f(): void; function f() {}", "function f(): void; declare function f(): void;", "function f<T>(a: T): T; function f(a: any) { return a }",
      "function f(this: A): void; function f(this: any) {}", "function f(a: A,): void; function f(a: any) {}", "function f(...a: A[]): void; function f() {}",
      "function f(a = 1): void; function f(a: any) {}", "function f({ a }: A): void; function f(a: any) {}", "function f(a?: A): a is A; function f(a: any) { return true }",
      "{ function f(): void; function f(a?: any) {} }", "function g() { function f(): void; function f(a?: any) {} }",
      "namespace N { function f(): void; function f(a?: any) {} }", "namespace N { export function f(): void; export function f(a?: any) {} }",
      "if (a) function f(): void;", "label: function f(): void;", "var v = function f(): void;", "var v = function (): void;",
      "var v = { m(): void; m() {} };", "var v = { m(): void };", "var v = { m(); };", "var v = () : void;", "var v = (): void => ;",
      "function f(): void {} function f(): void;", "function f(): void;\nfunction f(): void;\nfunction f(): void;\nfunction f() {}",
      "function f(): void; export {};", "function f(): void; export function f() {}", "export function f(): void; function f() {}",
      "function f(): void /* c */ ; function f() {}", "function f(): void // c\nfunction f() {}", "function f(): A<B>; function f(): any {}",
      "function f(): A<B>\nfunction f(): any {}", "function f(): typeof a\nfunction f(): any {}", "function f(): A.B\nfunction f(): any {}",
      "function f(): A\n<T>() => {}", "function f(): void; async function f() {}", "function f(): void; function* f() {}",
    ],
  },
]);
