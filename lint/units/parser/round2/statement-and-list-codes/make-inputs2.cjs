// Writes inputs2.json: rows that the first run raised. usage: node make-inputs2.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
const B = "\\";
g("end of file inside a list", [
  "{ foo;", "{", "function f() { foo;", "function f() {", "if (x) {", "class C { m() {", "namespace N {", "namespace N { foo;", "x = () => {", "x = function () { foo;",
  "try {", "try { foo;", "try {} catch {", "try {} finally {", "for (;;) {", "while (x) { foo;", "label: {", "class C { static {", "x = { m() {", "switch (x) { case 1: {",
  ["js", "{ foo;"], ["js", "function f() {"],
]);
g("names after a declaration keyword", [
  "interface +", "interface 'a'", "interface `a`", "interface class", "interface {", "interface\nFoo {}", "interface 1n", "interface #a", "interface <", "interface =",
  "type +", "type 'a'", "type class", "type {", "type\nFoo = 1", "type #a", "type <", "type (", "type [", "type ;",
  "namespace +", "namespace 'a'", "namespace class", "module class", "namespace\nFoo {}", "namespace #a", "module 'a' {}", "module 'a'", "module 'a' foo", "namespace =",
  "declare 1", "declare +", "declare {", "declare class", "declare\nfoo", "abstract 1", "abstract {", "abstract class", "global 1", "global {",
]);
g("statements that are one name", [
  "function f() { await x }", "function f() { yield x }", "let 1", "let +", "let\nx", "let x\ny", "static 1", "static", "static foo()", "public", "public 1", "static\nfoo", "readonly\nx",
  "foo " + B + "u0074ype", "foo " + B + "u0076ar x", "async\nfoo", "async 1", "async +", "accessor 1", "constructor x", "constructor 1", "get 1", "set +", "of 1", "type\n1",
  "foo bar()", "foo bar = 1", "foo.bar baz", "foo[0] baz", "foo`a` baz", "foo++ baz", "foo?.bar baz", "foo<T> baz", "foo<T>() baz", "foo as T", "foo as", "foo satisfies",
  "x = foo bar", "return foo bar", "if (a) foo bar; else baz qux", "while (a) foo bar", "for (;;) foo bar", "with (a) foo bar", "do foo bar; while (a)", "{ foo bar; baz qux }",
  "export default foo bar", "case", "default", "else", "catch", "finally", "extends", "in", "instanceof", "implements x", "package x", "private", "protected x", "yield", "yield x",
  "undefined", "NaN x", "Infinity x", "arguments x", "eval x", "this x", "super x", "null x", "true x", "new x y", "void x y", "typeof x y", "delete x y", "await x y",
  "abstract", "abstract\nclass C {}", "declare\nclass C {}", "type\nT = 1", "namespace\nN {}", "module\nN {}", "interface\nI {}", "global\n{}", "async\nfunction f() {}",
  "enum\nE {}", "const\nenum E {}", "class\nC {}", "function\nf() {}", "var\nx", "let\nx = 1", "const\nx = 1", "import\nx from 'y'", "export\nconst x = 1",
]);
g("parentheses that may hold parameters", [
  "x = (a, :)", "x = ({a, :})", "x = ([a, :])", "x = (a, :) => 1", "x = ({a, :}) => 1", "x = ([a, :]) => 1", "x = (:)", "x = (:) => 1", "x = (a, )", "x = (a, ) => 1", "x = (b, )",
  "f(a, (b, ))", "x = ()", "x = (,)", "x = (,) => 1", "x = (a b)", "x = (a b) => 1", "x = (...)", "x = (...) => 1", "x = (a, ...)", "x = (a = )", "x = (a = ) => 1",
  "x = async (:)", "x = async (a, :)", "x = <T>(a, :) => 1", "x = (a: )", "x = (a: ) => 1", "x = (a?: )", "x = (a, b c) => 1", "x = (a, ;", "x = (", "x = (a,",
]);
g("lists in for and in classes", [
  "for (var a b;;) {}", "for (let a of b c) {}", "for (var a, b c;;) {}", "for (var a = 1 b;;) {}", "for (a b;;) {}", "for (;; a b) {}", "for (var a in b c) {}", "for (var a b in c) {}",
  "for (const a b of c) {}", "for (using a b of c) {}", "for (var [a b] of c) {}", "for (var {a b} of c) {}", "for (var a, of) {}", "for (var a, in b) {}", "for (var a,;;) {}",
  "var a = 1 in b", "var a =>", "var a = 1 =>", "var a in b", "var a of b", "var a\nb", "var a,\nb", "var a, b c", "let a = 1, b c", "const a = 1 b = 2", "using a = 1 b",
  "export var a b", "export let a b", "export const a = 1 b", "declare let a b", "declare const a b", "var a: T b", "var a!: T b", "var a! b", "var [a] b", "var {a} b",
  "x = {#a: 1}", "x = {a: 1, #b: 2}", "x = {get}", "x = {get a}", "x = {get a()}", "x = {async}", "x = {async a}", "x = {static a}", "x = {a?: 1}", "x = {a!: 1}", "x = {a: 1 = 2}",
  "x = {a = 1}", "x = {a, b = 1}", "x = {'a'}", "x = {1}", "x = {[a]}", "x = {class}", "x = {var}", "x = {a.b}", "x = {a() {} b() {}}", "x = {a() {}; b() {}}", "x = {a, b;}",
]);
g("import attributes", [
  'import x from "y" assert\n{ type: "json" };', 'export { a } from "y"\nassert { type: "json" };', 'export * from "y" with\n{ type: "json" };', 'import x from "y"\nwith\n{ type: "json" };',
  'import x from "y" with;', 'import x from "y" with {', 'import x from "y" with { : };', 'import x from "y" with { a };', 'import x from "y" with { a: };', 'import x from "y" with { a: 1 };',
  'import x from "y" with { a: "b" c: "d" };', 'import x from "y" with { a: "b"; c: "d" };', 'import x from "y" with { a: "b", };', 'import x from "y" with { a: "b",, };', 'import x from "y" with { 1: "b" };',
  'import x from "y" with { "a": "b" };', 'import x from "y" with { + };', 'import x from "y" with { a: "b", + };', 'import x from "y" with { a: "b" } foo;', 'export * from "y" with { : };',
  'import x from "y" assert { : };', 'import x from "y" assert { a: "b" c };', 'type T = import("y", { with: { : } });', 'type T = import("y", { with: { a: "b" c: "d" } });', 'type T = import("y", { with: { a: "b" } );',
  'type T = import("y", { with { a: "b" } });', 'type T = import("y", { assert { a: "b" } });', 'type T = import("y", { });', 'type T = import("y", );', 'type T = import("y", { with: { a: "b" }, });',
  'type T = import("y", { assert: { a: "b" }, });', 'import("y", { with: { type: "json" } });', 'import x from "y" with { type: "json" }, z;', 'import "y" with { type: "json" } assert { type: "json" };',
  ["js", 'export * from "y" assert { type: "json" };'], ["js", 'import "y" with { : };'], ["tsx", 'import x from "y" assert { type: "json" };'],
  'import x = require("y") assert { type: "json" };', 'import type { a } from "y" assert { type: "json" };', 'export type * from "y" assert { type: "json" };', 'import defer * as x from "y" assert { type: "json" };',
]);
g("type-side lists", [
  "type T = (a b) => void", "type T = { m(a b): void }", "type T = new (;) => void", "let f: (class) => void", "let f: (a, class) => void", "let f: (a, +) => void", "let f: (a, ) => void", "let f: (a, ;",
  "let f: (a: T, :) => void", "let f: (...) => void", "let f: (...a, :) => void", "let f: (a, 1) => void", "let f: (a, 'b') => void", "let f: (a, null) => void", "let f: (a, void) => void",
  "let f: (a, function) => void", "let f: (a, var) => void", "let f: (a, [) => void", "let f: (a, {) => void", "let f: (a, () => void", "let f: (a, <) => void", "let f: (a, |) => void", "let f: (a, -) => void",
  "let f: (a, *) => void", "let f: (a, ?) => void", "let f: (a, !) => void", "let f: (a, @) => void", "let f: (a, #b) => void", "let f: (a, typeof) => void", "let f: (a, import) => void", "let f: (a, new) => void",
  "let f: (a, this) => void", "let f: (a, true) => void", "let f: (a, `b`) => void", "let f: (a, 1n) => void", "let f: (a, keyof) => void", "let f: (a, readonly) => void", "let f: (a, unique) => void", "let f: (a, infer) => void",
  "function f<T,>() {}", "function f<,>() {}", "type T<> = 1", "class C<> {}", "function f<T extends>() {}", "function f<T = >() {}", "function f<T U>() {}", "function f<in>() {}", "function f<const>() {}",
  "function f<T, in>() {}", "function f<T, const>() {}", "function f<in out>() {}", "function f<public T>() {}", "function f<T, public>() {}", "type T<U, extends> = 1", "type T<U, =  V> = 1", "type T<U, V W> = 1",
  "type T<U;> = 1", "type T<U, V;> = 1", "type T<U, (> = 1", "type T<U, {> = 1", "type T<U, implements> = 1", "interface I<T, :> {}", "x = function <T, :>() {}", "class C { m<:>() {} }", "x = { m<T, :>() {} }",
  "x = <T, :>(a) => 1", "let f: <T, :>() => void", "let f: new <T, :>() => void", "type T = { <U, :>(): void }", "type T = { new <U, :>(): void }", "type T = { m<U, :>(): void }", "declare function f<T, :>(): void;",
  "type T = [a b]", "type T = [a, :]", "type T = [:]", "type T = [a, ;", "type T = [", "type T = [a,", "type T = A<b c>", "type T = A<b, :>", "type T = A<:>", "type T = A<b, ;", "type T = A<", "type T = A<b,",
  "type T = { a: string b: number }", "type T = { a b }", "type T = { : }", "type T = { a: 1, : }", "type T = { a: 1; ) }", "type T = {", "type T = { a: 1,", "interface I { : }", "interface I { a b }", "interface I {",
  "interface I { a: 1 b: 2 }", "interface I { a(): void b(): void }", "interface I { a() b }", "interface I { (): void ) }", "interface I { [k: string]: any ) }", "interface I { get a(): void b }", "interface I { a?: }",
]);
g("TS1260 more", [
  "foo " + B + "u0076ar", "x = " + B + "u0061wait y", "x = " + B + "u0079ield", B + "u0077ith (x) {}", B + "u0077hile (x) {}", B + "u0066or (;;) {}", B + "u0074ry {} catch {}", B + "u0073witch (x) {}",
  B + "u0072eturn", B + "u0062reak", B + "u0063ontinue", B + "u0063ase", B + "u0064efault", B + "u0065num E {}", "c" + B + "u006fnst " + B + "u0065num E {}", "class C { c" + B + "u006fnstructor() {} }",
  "class C { 'constructor'() {} }", "x = " + B + "u0069n", "x = a ? " + B + "u0074rue : b", "f(" + B + "u0074rue)", "[" + B + "u0074rue]", "({ a: " + B + "u0074rue })", "x." + B + "u0074rue", "({ " + B + "u0074rue: 1 })",
  "({ " + B + "u0074rue })", "var { " + B + "u0074rue: a } = x", "var { " + B + "u0063lass } = x", "import { " + B + "u0064efault as a } from 'y'", "export { a as " + B + "u0064efault }", "label" + B + "u0031: x",
  "function " + B + "u0066unction() {}", "class " + B + "u0063lass {}", "var " + B + "u006cet = 1", "let " + B + "u006cet = 1", "var " + B + "u0073tatic = 1", "var " + B + "u0069mplements = 1", "var " + B + "u0065num = 1",
  "x = " + B + "u0073tatic", "x = " + B + "u006cet", B + "u006cet", B + "u0073tatic", B + "u0074ype", B + "u0061sync", B + "u0061wait", B + "u0079ield", B + "u006ff", B + "u0067et",
  "enum E { A = " + B + "u0074rue }", "type T = " + B + "u0074rue", "type T = " + B + "u0074his", "type T = t" + B + "u0079peof x", "type T = k" + B + "u0065yof U", "type T = " + B + "u0075nique symbol", "type T = " + B + "u0069nfer U",
  "type T = " + B + "u006eever", "type T = " + B + "u0075nknown", "type T = " + B + "u006fbject", "type T = " + B + "u0073tring.a", "type T = " + B + "u0061ny[]", "type T = { " + B + "u0072eadonly a: 1 }", "type T = { " + B + "u0067et a(): 1 }",
  "type T = " + B + "u0061sserts", "function f(x): " + B + "u0061sserts x {}", "function f(x): x " + B + "u0069s string {}", "type T = " + B + "u0061bstract new () => void", "type T = " + B + "u006eew () => void",
  "let x = y " + B + "u0061s " + B + "u0063onst", "x = <" + B + "u0061ny>y", "class C<" + B + "u0069n T> {}", "class C<" + B + "u006fut T> {}", "function f<" + B + "u0063onst T>() {}", "type T = { [K " + B + "u0069n U]: 1 }",
  "type T = { [K in U " + B + "u0061s V]: 1 }", "import x = " + B + "u0072equire('y')", "export " + B + "u0061s namespace N", "export as " + B + "u006eamespace N", "export = " + B + "u0074rue", "export * " + B + "u0061s x from 'y'",
  "import * " + B + "u0061s x from 'y'", "export { a " + B + "u0061s b }", "export " + B + "u0074ype { a }", "export " + B + "u0074ype T = 1", "export " + B + "u0069nterface I {}", "export d" + B + "u0065clare const x: 1",
  "export " + B + "u0061bstract class C {}", "export default " + B + "u0061bstract class C {}", "export " + B + "u0061sync function f() {}", "export default " + B + "u0061sync function f() {}", "for " + B + "u0061wait (x of y) {}",
  "class C { " + B + "u0061ccessor x }", "class C { d" + B + "u0065clare x: 1 }", "class C { " + B + "u0061bstract x: 1 }", "class C { " + B + "u006fverride x = 1 }", "class C { " + B + "u0073et x(v) {} }", "class C { static " + B + "u0061sync m() {} }",
  "class C { " + B + "u0070rivate x }", "class C { " + B + "u0070rotected x }", "class C { constructor(" + B + "u0070ublic x) {} }", "class C { constructor(" + B + "u0072eadonly x) {} }", "function f(" + B + "u0070ublic x) {}",
  B + "u0075sing x = y", "await " + B + "u0075sing x = y", "x = n" + B + "u0065w.target", "x = import." + B + "u006deta", "x = " + B + "u0069mport.meta", "x = new." + B + "u0074arget",
]);
require("node:fs").writeFileSync(__dirname + "/inputs2.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
