// Writes the case lists of this research: js-no-unused-vars.json and ts-no-unused-vars.json (arrays of { code, ext }).
// usage: node make-lists.cjs     (the lists are the input of regen.cjs / diff.cjs of the oracle tools, and of ../model/check-*.cjs)
"use strict";
const fs = require("fs");
const path = require("path");
const js = [
	// the shape of the body of a for-in/of
	"function g(o) { for (var x in o) { ; return; } } g();",
	"function g(o) { for (var x in o) { return; ; } } g();",
	"function g(o) { for (var x in o) { 'use strict'; return; } } g();",
	"function g(o) { for (var x in o) { /*! kept */ return; } } g();",
	"function f(b) { for (const a of b) { { return } } } f();",
	"function f(b) { for (const a of b) { return; ; } } f();",
	"function f(b) { for (const [a] of b) return; } f();",
	"function f(b) { var a; for ([a] of b) return; } f();",
	"function f(b) { var a; for (a.x of b) return; } f();",
	"function f(b) { var a; for ((a) of b) return; } f();",
	"function foo(o) { for (var k in foo) { return; } }",
	"var a, b; for (a of b);",
	// parameters
	"function f(a, b = 1) {} f();",
	"function f(a, {b}) {} f();",
	"function f(a, b) { b = 1 } f();",
	"function f(a, b) { b++ } f();",
	"function f(a, b, c) { return b; } f();",
	"function f(a, [b], c) { return c; } f();",
	"(function(a, b) { return arguments; })();",
	"function f(a, a2) { a2; } f();",
	"const f = (a, b) => b; f();",
	"const f = (a, ...b) => 1; f();",
	"({ set x(v) {}, m(w) {} });",
	"class A { set x(v) {} static set y({ a }) {} m(w) {} } new A();",
	"function f(a) { var a; } f();",
	"function f(a) { function a() {} } f();",
	// reads for itself, right sides
	"var a; a = function() { a(); };",
	"let a; a ??= 1;",
	"let a; a ||= 1, 0;",
	"var i; for (i = 0;;) {}",
	"for (var i = 0; i < 1; i++) {}",
	"var x, c; while (c) { x = x + 1 }",
	"var x, c; do x = x + 1; while (c)",
	"var x; for (;;) { x = x + 1 }",
	"var x; for (x = x + 1;;) {}",
	"let a = 1; { a = a + 1; }",
	"let a; function f() { a = a + 1 } f();",
	"let a, b; a = (b = a); ",
	"var a = 1; a = a || 2;",
	"var a = 1; a = (a, 2);",
	"var a = 1; a = b(a);",
	"var a = 1; a = b(() => a);",
	"var a = 1; a = (() => a)();",
	"var a = 1; a = [() => a];",
	"var a = 1; a = { m() { return a } };",
	"var a = 1; a = class { m() { return a } };",
	"var a = 1; a = class { static { function g() { return a } } };",
	"var a = 1; a = class { static { g(function() { return a }) } };",
	"var a = 1; a = class { static x = () => a; };",
	"var a = 1; a = class { [(() => a)()]() {} };",
	"var a = 1; a = function() { function g() { return a } };",
	"var a = 1; a = function() { return () => a };",
	"var a = 1; a = function() { var g = () => a; };",
	"var a = 1; a = () => () => a;",
	"var a = 1; a = function(x = () => a) {};",
	"var a = 1; a = function({ x = () => a }) {};",
	"var a = 1; a = `${() => a}`;",
	"var a = 1; a = t`${() => a}`;",
	"var a = 1; a = (() => a)`x`;",
	"var a = 1; a = new (function() { a })();",
	"var a = 1; a = new B(function() { a });",
	"function* g() { var a = 1; a = yield () => a; } g();",
	"async function g() { var a = 1; a = await (() => a); } g();",
	"var a = 1; a = (b = () => a);",
	"var a = 1; a = ([b = () => a] = c);",
	"var a = 1; a = (() => a, 1);",
	"var a = 1; a = (1, () => a);",
	"var a = 1; a = (1, (2, () => a));",
	"var a = 1; a = b?.(() => a);",
	"var a = 1; a = b ? () => a : 0;",
	"var a = 1; a = a ? a : a;",
	"var a = 1; a = a++;",
	"var a = 1; a += a++;",
	"var a = 1; a = 1, a;",
	"var a = 1; a = 1; a = a + 1; a;",
	"var a = 1; (a = a + 1);",
	"var a = 1; a = a + 1, a = a + 2;",
	"var a = 1; b = a = a + 1;",
	"var a = 1; if (c) a = a + 1;",
	"var a = 1; l: a = a + 1;",
	"var a = 1; (() => a = a + 1)();",
	"var a = 1; (() => { a = a + 1 })();",
	"var a = 1; a++ ? 1 : 2;",
	"var a = 1; +a++;",
	"var a = 1; a--;",
	"var a = 1; --a, ++a;",
	"var a = 1; void (a += 1);",
	// destructuring
	"const {a, ...rest} = o; rest;",
	"var a; ({ a } = obj);",
	"var a; [a] = arr;",
	"var a; ({ a = 1 } = obj)",
	"var a; [a = a] = arr;",
	"var a; ({ b: a = 1 } = obj), a;",
	// functions, classes, names
	"var f = function g() { g() }; f()",
	"var A = class B { m() { B } }; A;",
	"class A { m() { return new A(); } }",
	"class A { static x = A; } ",
	"(class A {});",
	"function f() { return f2; function f2() {} } f();",
	"const f = function() { f(); }, g = () => g();",
	"var {f} = function() { f(); };",
	"{ function f() {} } f();",
	"if (x) { function f() {} }",
	// catch
	"try {} catch {}",
	"try {} catch ({ message }) {}",
	"try {} catch ([a, b]) { b }",
	"try {} catch (e) { e = 1 }",
	// exports and imports
	"import a from \"a\"; export { a }",
	"var a; export { a as b };",
	"export var a, { b, c: [d] } = x;",
	"var a = 1; export default a;",
	"export default function f() { f() }",
	"export default class A {}",
	"export default (function f() {});",
	"function f() {} export { f as default };",
	"import * as ns from \"a\"; ns.x;",
	"import a, { b as c } from \"a\"; c;",
	"export * as ns from \"a\"; import { ns } from \"b\";",
	// other
	"var a; typeof a;",
	"var a; delete a.b;",
	"var a; a;",
	"var a; a?.b;",
	"var a; ({ a });",
	"var a; ({ [a]: 1 });",
	"var a; ({ a: 1 });",
	"var a; b.a;",
	"a: for (;;) { break a; } var a;",
	"var a; a = 1; a = 2; var b = a;",
	"using r = get(); ",
	"await using r = get();",
	"var \\u0061; ",
	"let a; a = 1; function f() { a = 2 } f();",
	"let a; function f() { a = 2 } f();",
	"var undefined;",
	"var arguments2; (function() { arguments; })();",
].map(code => ({ code }));
const jsx = [
	"import React from \"react\"; export default <div/>;",
	"import Foo from \"foo\"; export default <Foo/>;",
	"import Foo from \"foo\"; export default <Foo></Foo>;",
	"import foo from \"foo\"; export default <foo/>;",
	"import foo from \"foo\"; export default <foo.bar/>;",
	"import _x from \"x\"; import $y from \"y\"; export default <_x><$y/></_x>;",
	"import a from \"a\"; export default <a:b/>;",
	"import a from \"a\"; export default <div a={a}/>;",
	"import a from \"a\"; export default <div {...a}/>;",
	"import a from \"a\"; export default <div>{a}</div>;",
	"import a from \"a\"; export default <div a:b=\"1\"/>;",
	"import a from \"a\"; export default <></>;",
	"class C { m() { return <this.x/> } } export default C;",
].map(code => ({ code, jsx: true }));
const cjs = [
	"var a = 1; with (o) { a }",
	"with (a) var foo;",
	"function f(arguments) {} f();",
	"function f() { var arguments; } f();",
	"var a; return;",
	"x = 1; var y = x;",
	"function f() { 'use strict'; var a; } f();",
].map(code => ({ code, ext: "cjs" }));

const ts = `
import { A } from "a"; let x: A; export { x };
import type { A } from "a"; let x: A; export { x };
import type { A } from "a";
import { type A, b } from "a"; b();
import { type A, b } from "a"; let x: A = b(); export { x };
import { A } from "a"; let x: typeof A; export { x };
import type { A } from "a"; let x: typeof A; export { x };
import type A from "a"; export let x: typeof A.x;
import type * as N from "n"; export let x: N.T;
import A, { type B } from "a"; export let x: B = A;
const a = 1; let x: typeof a; export { x };
const a = 1; export type T = typeof a;
const a = { b: 1 }; export type T = typeof a.b;
const a = 1; export type T = keyof typeof a;
const a = [1]; export type T = (typeof a)[number];
function f(a: unknown): a is string { return true; } f(1);
function f(a: unknown): asserts a is string {} f(1);
function f(a: unknown): asserts a {} f(1);
export function f(a: number, b: number): b is number { return true }
export function f(a: number): typeof a { return a }
export function f(a: number, _b: typeof a) {}
function foo(): typeof foo { return 1 as any }
enum E { A, B }
enum E { A, B } E.A;
export enum E { A, B }
enum E { A = 1, B = A }
enum E { A = 1, B = E.A }
enum E { 'a' = 1, b = a }
enum E { A } export const e = E;
const enum E { A } export const e = E.A;
declare enum E { A }
enum E { A } namespace E { export const b = 1 }
enum E { A } enum E { B } E.A;
namespace N { export const a = 1; }
namespace N { const a = 1; }
namespace N { export const a = 1; } N.a;
export namespace N { const a = 1; export const b = 2; }
namespace N { export namespace M { export const a = 1; } }
namespace N { export const a = N; }
namespace N { export const a = 1; export const b = a; }
namespace A { export const a = 1 } namespace A { export const b = a }
namespace N { export type T = number } let x: N.T; export { x };
namespace A.B { const x = 1 }
namespace A.B.C { export const x = 1 }
declare namespace A.B { const x: number }
namespace A { namespace B { const x = 1 } } export {};
namespace A { declare namespace B { const x: number } } export {};
declare namespace A { namespace B { const x: number } } export {};
declare namespace N { const a: number; function f(): void; class C {} interface I {} type T = 1; enum E {} namespace M { const z: number } }
declare namespace N { const a: number; export {}; }
declare namespace N { const a: number; export { a }; const b: number; }
declare namespace N { const a: number; export default a; const b: number; }
declare namespace N { function f(): void; import x = M.y; }
declare const a: number;
declare let [a, b]: number[];
declare var v: number; v;
declare function f(a: number): void;
declare function f(): void; f();
declare class C { m(a: number): void }
declare class C { constructor(a: number); m(b: number): void; set x(v: number); } new C(1);
declare global { const a: number; interface Window { x: number } }
const global = 1; declare global { }
const global = 1; declare module "m" { global { const q: number } }
declare module "m" { const a: number; export const b: number; }
declare module "m" { const a: number; export { }; }
declare module "m" { import { X } from "x"; const a: number; }
declare module "m" { namespace Q { const a: number; } }
declare module "m";
interface I { a: number }
interface I { next: I }
interface A { a: number } interface A { b: number }
interface A { a: number } interface A { b: A }
interface I { a: number } export const x: I = { a: 1 };
class A {} interface A { x: number }
interface A {} class A {}
type T = number;
type T = T[];
type T<U> = number;
type T<U> = U[]; export type { T };
export type F = <T>(a: number) => void;
export type F = new <T>(a: number) => object;
export type A<T> = { [K in keyof T]: T[K] };
export type A = { [K in "a" as \`x\${K}\`]: number };
export type C<T> = T extends (infer U)[] ? number : string;
export type C<T> = T extends (infer U)[] ? U : string;
export interface I<T> { a: number }
export interface I<T> { a: T }
export interface I { m(a: number): void; new (b: number): I; (c: number): void; get g(): number; set g(v: number) }
function f<T>() {} f();
function f<T>(a: T) { return a } f(1);
export function f<T, U = T>(u: U) { return u }
export function f<const T>(a: T): T { return a }
export function f<T>(x: T extends infer U ? U : never) { return x }
export const x = <T,>(a: T) => a;
class C<T> {} new C();
export default class { m<T>() {} }
class C { constructor(private a: number, b: number) {} } new C(1, 2);
class C { constructor(a: number, private b: number) {} } new C(1, 2);
export class C { constructor(private readonly a = 1, public b?: number) {} }
function f(this: Window, a: number) {} f(1);
export class C { m(this: C, a: number) { return this } }
function o(a: number): void; function o(a: number, b?: number): void {}
function f(a: number): void; function f(a: number, b?: number): void {} f(1);
function f(): void; function f() { f(); }
export function f(): void; export function f() {}
function f(): void; export function f() {}
class C { m(): void; m(a?: number): void {} } new C();
abstract class C { abstract m(a: number): void; } new (C as any)();
export abstract class C { constructor(protected readonly a: number) {} abstract get x(): number; abstract set x(v: number); }
export class C { accessor a = 1; static { const z = 1; } }
export const o = { set x(v: number) {} };
export class C { set x(v: number) {} static set y({ a }: any) {} }
function f() {} namespace f { export const a = 1 }
class C {} namespace C { export const x = C }
import a = require("a");
import a = require("a"); a();
import type a = require("a"); export let x: a.T;
namespace N { export const x = 1 } import b = N.x;
namespace N { export const x = 1 } import b = N.x; b;
namespace N { export const x = 1 } export import b = N.x;
const a = 1; export = a;
interface I {} export = I;
import { a } from "a"; export = a;
export default interface I {}
interface I {} export default I;
type T = number; export { T };
type T = number; export { type T };
type T = number; const v = 1; export { type T, v };
type T = number; export type { T };
type T = number; export type { T as U };
const a = 1; export type { a };
const a = 1; export { a as default };
export as namespace Foo; const Foo = 1;
function dec(x: any) { return x } @dec class C {} export {};
import { dec } from "d"; class C { @dec m() {} @dec p = 1; m2(@dec a: number) {} } new C();
import { I } from "i"; class C implements I {} new C();
import { B } from "b"; class C<T extends B> { x!: T } new C();
const x = 1; const y = x as number; export { y };
import { T } from "t"; const y = 1 as T; export { y };
import { T } from "t"; const y = <T>1; export { y };
import { T } from "t"; const y = 1 satisfies T; export { y };
import { T } from "t"; function f(a: T) { return a } f(1);
import { T } from "t"; f<T>();
import { T } from "t"; new F<T>();
import { T } from "t"; new F<T>;
import { T } from "t"; tag<T>\`x\`;
import { T } from "t"; const g = f<T>; g();
import { T } from "t"; export interface I { a: T }
import { T } from "t"; export interface I extends T {}
import { T } from "t"; export interface I extends A<T> {}
import { T } from "t"; export type A = { a: T };
import { T } from "t"; export type A = [T];
import { T } from "t"; export type A = () => T;
import { T } from "t"; export type A = \`\${T}\`;
import { T } from "t"; export type A = T extends string ? 1 : 2;
import { T } from "t"; export type A = keyof T;
import { T } from "t"; export type A = typeof T;
import { T } from "t"; export type A = T.U.V;
import { T } from "t"; export type A = import("x").Y<T>;
import { T } from "t"; export class C { [k: string]: T }
import { T } from "t"; export class C { declare x: T }
import { T } from "t"; export abstract class C { abstract m(a: T): void }
import { T } from "t"; export abstract class C { abstract x: T }
import { T } from "t"; export class C { m(): void; m(a?: T): void { a } }
import { T } from "t"; export class C { m(): T; m(): any {} }
import { T } from "t"; export function f(): T { return 1 as any }
import { T } from "t"; export function f<U extends T>(u: U) { return u }
import { T } from "t"; export function f<U = T>(u: U) { return u }
import { T } from "t"; export const f = (x: unknown): x is T => true;
import { T } from "t"; export let x: Array<T>;
import { T } from "t"; export let x: T.U;
import { T } from "t"; export let x: typeof T;
import { T } from "t"; export let x: { [K in T]: number };
import { T } from "t"; declare const d: T; export { d };
import { T } from "t"; declare function g(a: T): void; g(1);
import { T } from "t"; declare namespace N { const a: T } export { N };
import { T } from "t"; export enum E { A = T }
import { T } from "t"; export class C<U extends T> { u!: U }
import { T } from "t"; export class C extends B<T> {}
import { T } from "t"; try {} catch (e: T) { e }
import { T } from "t"; for (const x of y as T[]) { x }
import { T } from "t"; export const x = { m(a: T) { return a } };
import { T } from "t"; export const x = (a: T = 1) => a;
import { T } from "t"; export const x = ({ a }: T) => a;
import { T } from "t"; export const x = (...a: T[]) => a;
import { T } from "t"; export function f(this: T) {}
import { T } from "t"; export class C { accessor a: T = 1 }
import { T } from "t"; export class C { get a(): T { return 1 } set a(v: T) {} }
import { T } from "t"; export let x = y!.z as unknown as T;
import { T } from "t"; export default <T,>(a: T) => a;
import { T } from "t"; let v: T; export {};
import { T } from "t"; export function f(a?: T) { return a }
import { T } from "t"; export function f([a]: T[]) { return a }
import { T } from "t"; export const f = function (a: T): void {};
import { T } from "t"; export const f = async <U extends T>(a: U): Promise<U> => a;
import { T } from "t"; export let x: unique symbol, y: T;
import { T } from "t"; export let x: [a: T, b?: string];
import { T } from "t"; export let x: new () => T;
import { T } from "t"; export let x: (a: T) => void;
import { T } from "t"; export let x: { a: T; m(b: T): void };
let a = 1; a! += 1;
let a = 1; (a as any) = 2;
let a = 1; (<any>a) = 2;
let a = 1; a!++;
let a = 1; (a as any)++;
let a: any; a = a! + 1;
let a: any; (a satisfies any) = 1;
let a: any; (a as any) = a + 1;
let x = 1; x = x satisfies number;
let x: any; (x = 1) as any;
let x: any; x = 1 as any;
let x: any; x = (x as number) + 1;
let x: any; (x = x + 1)!;
let x: any; (x++) as any;
let x: any; (x = 1, 2) as any;
let x: any; ((2, x = 1) as any);
const f = (() => { f(); }) as any;
const f = function () { f(); } satisfies Function;
const f = (function () { f(); })!;
const f = <any>(() => f());
const f = (() => { f(); });
let a: any; a = (function () { a(); }) as any;
let a: any; a = b(<any>function () { a(); });
function g(o: any) { for (const k in o) { return; } } g(1);
function g(o: any) { for (const k in o) { return; foo(); } } g(1);
function g(o: any) { for (const k in o) { ; return; } } g(1);
function g(o: any) { for (const k in o) { type T = 1; return; } } g(1);
function g(o: any) { for (const [a, b] of o) return; } g(1);
function g(o: any) { for (const { a, b } of o) return; } g(1);
function g(o: any) { let k; for (k in o) return; } g(1);
function g(o: any) { let k; for ((k as any) in o) return; } g(1);
function g(o: any) { let k; for (k! in o) return; } g(1);
function g(o: any) { let k, j; for ([k, j] of o) return; } g(1);
var a = 1; export var a = 2;
label: for (;;) { break label; }
let a: number; export default a;
export function f(a: number, { b }: any) { return b }
export function f({ a, ...rest }: any) { return rest }
export function f(a?: number, b = a) {}
export let x: typeof import("m");
import { N } from "n"; export let x: N.T;
import N from "n"; export let x: typeof N.x;
import * as N from "n"; export let x: N.T<N.U>;
export class C { private a = 1; #b = 2; }
export const x = <const T,>(a: T) => a;
using r = get();
export {}; declare const a: number; const b = a; 
import React from "react"; export const a = 1;
`.split("\n").filter(Boolean).map(code => ({ code, ext: "ts" }));
const dts = [
	"declare const a: number; declare function f(x: number): void; declare class C {} interface I {} type T = 1; declare enum E { A } declare namespace N { const z: number }",
	"declare const a: number; export {};",
	"declare const a: number; export declare const b: number;",
	"declare const a: number; export default a;",
	"declare const a: number; declare const b: number; export default b;",
	"import { X } from \"x\"; declare const a: X;",
	"import { X } from \"x\"; declare const a: number;",
	"declare namespace N { const a: number; export {}; } ",
	"namespace N { const a: number; }",
	"declare function f(): void; export = f;",
	"type T<U> = number;",
	"declare function f<T>(a: number): void;",
	"export * from \"x\"; declare const a: number;",
	"export * as ns from \"x\"; declare const a: number;",
	"export { x } from \"x\"; declare const a: number;",
	"export type { X } from \"x\"; declare const a: number;",
	"declare namespace A { namespace B { const x: number } }",
	"declare namespace A { namespace B { const x: number; export {} } }",
	"declare namespace A.B { const x: number }",
	"declare let [a, b]: number[];",
	"declare module \"m\" { import { X } from \"x\"; const a: number; }",
	"declare global { interface X {} } interface Y {}",
	"import a = require(\"a\"); declare const b: number;",
	"declare function f(a: number): void; declare function f(a: string): void;",
	"declare class C<T> { m<U>(a: U): void }",
	"interface I<T> {} type A = I<number>;",
].map(code => ({ code, ext: "d.ts" }));
const tsx = [
	"import React from \"react\"; import Foo from \"foo\"; import bar from \"bar\"; const a = <Foo/>; const b = <bar.baz/>; const d = <div/>; export {a,b,d}",
	"import React from \"react\"; export const x = 1;",
	"import React from \"react\"; export const x = <></>;",
	"import React from \"react\"; export const x = <div/>;",
	"const React = 1; export const x = <div/>;",
	"function f(React: any) { return <div/> } f(1); import React from \"react\";",
	"import a from \"a\"; import b from \"b\"; export default <a:b/>;",
	"import Foo from \"foo\"; import { T } from \"t\"; export default <Foo<T> />;",
	"import Foo from \"foo\"; export default <Foo></Foo>;",
	"import foo from \"foo\"; export default <foo/>;",
	"import a from \"a\"; export default <div a={a as any}/>;",
	"export class C { m() { return <this.x/> } }",
	"import h from \"h\"; export default <div/>;",
].map(code => ({ code, ext: "tsx" }));
const cts = [
	"const a = 1; export = a;",
	"import a = require(\"a\"); const b = 1;",
	"declare const d: number; function f() {}",
].map(code => ({ code, ext: "cts" }));
const write = (name, list) => fs.writeFileSync(path.join(__dirname, name), "[\n" + list.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
write("js-no-unused-vars.json", [...js, ...jsx, ...cjs]);
write("ts-no-unused-vars.json", [...ts, ...dts, ...tsx, ...cts]);
console.log({ js: js.length, jsx: jsx.length, cjs: cjs.length, ts: ts.length, dts: dts.length, tsx: tsx.length, cts: cts.length });
