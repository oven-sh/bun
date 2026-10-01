// Writes inputs3.json: class names, heritage lists, accessors and other rows that the second run raised. usage: node make-inputs3.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
const B = "\\";
g("class and function names", [
  "class class {}", "class 1 {}", "class + {}", "class extends A {}", "class {}", "class var {}", "class implements A {}", "class implements {}", "class C D {}", "class C<T> D {}",
  "x = class class {}", "x = class 1 {}", "function 1() {}", "function +() {}", "function var() {}", "function () {}", "function f g() {}", "function* () {}", "async function () {}",
  "x = function 1() {}", "x = function var() {}", "enum 1 {}", "enum class {}", "enum E F {}", "namespace N M {}", "namespace N.1 {}", "namespace N. {}", "interface I J {}", "type T U = 1",
  "import 1 from 'y'", "import x y from 'y'", "import { 1 } from 'y'", "import { a b } from 'y'", "import { a, : } from 'y'", "import { : } from 'y'", "import { a as } from 'y'", "import { a as 1 } from 'y'",
  "import { a", "import { a,", "import {", "import * from 'y'", "import * as from 'y'", "import * as 1 from 'y'", "import x, from 'y'", "import x, 1 from 'y'", "import x from", "import x from 1",
  "export { : }", "export { a b }", "export { a, : }", "export { 1 }", "export { a as }", "export {", "export { a", "export { a,", "export * as", "export * as 1 from 'y'", "export * from", "export * from 1",
  "export { a } from", "export { a } 'y'", "export { from 'y'", "import { from 'y'", "export 1", "export +", "export default", "export default ;", "export =", "export = ;", "export as namespace", "export as namespace 1", "export as foo",
  ["js", "class class {}"], ["js", "import { : } from 'y'"], ["js", "export { a b }"],
]);
g("heritage lists", [
  "class C extends A, {}", "class C extends A, B, {}", "class C implements A, {}", "class C implements A, : {}", "class C extends A B {}", "class C extends A implements {}", "class C extends A implements B, {}",
  "class C extends A { } { }", "class C extends {} {}", "class C extends A, {} {}", "class C extends A<T> B {}", "class C extends A<T>, {}", "class C extends A() {}", "class C extends (A) {}", "class C extends A.b {}",
  "class C extends A?.b {}", "class C extends A + B {}", "class C extends A = B {}", "class C extends A ? B : C {}", "class C extends A as B {}", "class C extends <T>A {}", "class C extends new A {}", "class C extends await A {}",
  "class C extends class {} {}", "class C extends function () {} {}", "class C extends [] {}", "class C extends 1 {}", "class C extends 'a' {}", "class C extends `a` {}", "class C extends this {}", "class C extends null {}",
  "class C extends A\n{}", "class C extends\nA {}", "class C extends A implements B extends D {}", "interface I extends A, {}", "interface I extends A, : {}", "interface I extends A B {}", "interface I implements A {}",
  "interface I extends A extends B {}", "interface I extends A.b {}", "interface I extends A() {}", "interface I extends 1 {}", "interface I extends A<T> B {}", "interface I extends typeof A {}", "interface I extends { a: 1 } {}",
  "class C implements A.b<T>, B {}", "class C implements A() {}", "class C implements 1 {}", "class C implements typeof A {}", "class C implements { a: 1 } {}", "class C implements A B {}", "class C extends A implements B C {}",
]);
g("bodies of functions and accessors", [
  "class C { get x() bar }", "class C { set x(v) bar }", "class C { get x() }", "class C { static get x() bar }", "class C { get x(): T bar }", "class C { get x() { function g() bar } }", "class C { m() { function g() bar } }",
  "x = { get a() bar }", "x = { m() bar }", "x = { m(): T bar }", "x = () bar", "x = () => bar baz", "x = async () bar", "x = function* () bar", "x = async function () bar", "class C { m() bar() {} }", "class C { m()\nbar }",
  "class C { m(): T\nbar }", "class C { m() }", "class C { m();\nm() bar }", "class C { constructor(); constructor() bar }", "abstract class C { abstract m() {} }", "declare class C { m() {} }", "declare function f() {}",
  "function f() { function g() bar }", "if (a) function f() bar", "export default function f() bar", "export default class { m() bar }", "export default async function () bar", "namespace N { function f() bar }", "namespace N { export function f() bar }",
  "declare namespace N { function f() bar }", "class C { m() , }", "class C { m() : }", "class C { m() = 1 }", "class C { m() => 1 }", "class C { m() ) }", "function f() ,", "function f() )", "function f() = 1", "function f(): T = 1",
  ["js", "class C { get x() bar }"], ["js", "x = { m() bar }"], ["js", "class C { m() }"], ["js", "function f()"], ["js", "class C { constructor() bar }"], ["js", "function* f() bar"], ["js", "async function f() bar"],
]);
g("throw, labels and the last statement of a file", [
  "throw foo bar", "throw foo.bar baz", "throw new E() bar", "throw", "throw;", "throw\nfoo", "throw foo\nbar", "throw cosnt x", "throw is x", "throw type 1", "throw interface {", "throw let 1", "throw async foo", "throw (foo) bar", "throw foo! bar",
  "foo: bar baz", "foo: cosnt x = 1", "foo: { bar baz }", "a: b: c d", "foo bar", "foo bar\n", "foo bar ", "foo /* c */", "foo // c\nbar baz", "foo\n/* c */ bar baz", "(foo bar)", "[foo bar]", "{ a: foo bar }", "x = { a: foo bar }", "f(foo bar)",
  "`${foo bar}`", "if (foo bar) {}", "while (foo bar) {}", "for (foo bar;;) {}", "for (;foo bar;) {}", "for (x of foo bar) {}", "switch (foo bar) {}", "switch (x) { case foo bar: }", "return foo bar", "x = foo bar", "x ? foo bar : y", "x ? y : foo bar",
]);
g("await and yield spelled with an escape", [
  "async function f() { " + B + "u0061wait x; }", "async function f() { x = " + B + "u0061wait y; }", "function* g() { " + B + "u0079ield 1; }", "function* g() { x = " + B + "u0079ield; }", B + "u0061wait x", "x = " + B + "u0061wait y",
  "async function f() { for " + B + "u0061wait (x of y) {} }", "async () => " + B + "u0061wait x", "function f() { " + B + "u0061wait x }", "function f() { var " + B + "u0061wait }", "async function f() { var " + B + "u0061wait }",
  "function* g() { var " + B + "u0079ield }", "function f() { var " + B + "u0079ield }", "x = { " + B + "u0061wait: 1 }", "x." + B + "u0061wait", "async function f() { x." + B + "u0061wait }", "async function f() { ({ " + B + "u0061wait }) }",
]);
require("node:fs").writeFileSync(__dirname + "/inputs3.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
