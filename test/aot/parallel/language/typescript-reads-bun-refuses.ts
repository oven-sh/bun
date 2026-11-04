// @ts-nocheck
// Each line down to `dec` holds one text of TypeScript's own syntax that `bun run` reports a syntax error in. TypeScript's parser reads them all. What `bun run` rejects stops the build,
// checked or not: the errors below are the lines that a build finds today. The other lines pass when they stand alone, which is a gap.
class C1 implements never() {}
declare class C2 { #x; #x; }
declare enum E1 { [never()] }
class C3 { declare static prototype; }
declare let let;
declare function f1(@never a);
var c4 = @dec abstract class {};
interface I1 { get x() { return never() } }
function f2<public T>() {}
type T1 = (public a) => void;
function f3(public a); function f3(a) {}
interface I2 { #a }
var f4 = (a? = 1) => a;
var x1: if;
function f5(...a, b); function f5(a) {}
import type d1, { d2 } from "node:fs";
class C5 { constructor(abstract a) {} }
class C6 { accessor readonly x = 1; }
function f6(a: asserts b) {}
function f7(a: import(x)) {}
class C7 { [k: string, j: string]: any; }
class C8 { [k?: string]: any; }
class C9 { [k: string]; }
function f8(a: (b = never()) => void) {}
interface I3 { a: number = never() }
interface I4 extends never() {}
interface I5 extends {}
declare import "node:fs";
declare using u1;
declare using u2 = never();
declare async var v1;
abstract declare class C10 {}
abstract class C11 { abstract abstract x; }
function f9(a: ?A) {}
class C12<out in T> {}
function f10<in T>() {}
function dec(...a) { console.log("dec", a.length, typeof a[0]); }
function never() { console.log("never"); }
console.log(typeof C2, typeof E1, typeof f1, typeof u1, typeof u2, typeof v1, typeof C10);
console.log(typeof C1, typeof C3, typeof c4, typeof C12, x1);
console.log(f2.length, f3.length, f4.length, f4(), f5.length, f6.length, f7.length, f8.length, f9.length, f10.length);
console.log(Object.keys(new C5(1)).length, new C6().x, Object.keys(new C6()).length);
console.log(Object.keys(new C7()).length, Object.keys(new C8()).length, Object.keys(new C9()).length, Object.keys(new (class extends C11 {})()).length);
/* Build errors:
error: TS1206: Decorators are not valid here.
error: TS1183: An implementation cannot be declared in ambient contexts.
error: TS2369: A parameter property is only allowed in a constructor implementation.
error: TS18016: Private identifiers are not allowed outside class bodies.
error: TS1014: A rest parameter must be last in a parameter list.
error: TS1096: An index signature must have exactly one parameter.
error: TS1019: An index signature parameter cannot have a question mark.
error: TS1021: An index signature must have a type annotation.
error: TS2371: A parameter initializer is only allowed in a function or constructor implementation.
error: TS1246: An interface property cannot have an initializer.
error: TS1097: 'extends' list cannot be empty.
error: TS17020: '?' at the start of a type is not valid TypeScript syntax. Did you mean to write 'any'?
*/
