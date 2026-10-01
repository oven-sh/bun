// Writes inputs2.json: rows that settle the token rules of the list helpers. usage: node make-inputs2.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
g("parameters: tokens that start a type", [
  "function f(*) {}", "function f(?) {}", "function f(!) {}", "function f(<) {}", "function f(|) {}", "function f(&) {}", "function f(-) {}", "function f(()) {}",
  "function f(`a`) {}", "function f(`a${b}`) {}", "function f(1n) {}", "function f(a, *) {}", "function f(a, ?) {}", "function f(a, !) {}", "function f(a, <) {}", "function f(a, |) {}",
  "function f(a, &) {}", "function f(a, -) {}", "function f(a, () ) {}", "function f(a, [) {}", "function f(a, {) {}", "function f(a, >>) {}", "function f(a, >=) {}", "function f(a, >>>) {}",
  "function f(a, >>=) {}", "f(a, >>)", "x = [a, >>]", "var a, >>", "class C { >> }", "x = {a: 1, >>}", "switch (x) { >> }", "enum E { >> }", "try {} >>", "var {a, >>} = x", "var [a, >>] = x", "type T<U, >>> = 1",
]),
g("arguments and arrays: more tokens", [
  "f(,)", "f(a,,)", "new A(,)", "f(a, =>)", "f(a, ...)", "f(a, ...,)", "x = [a, ...]", "x = [a, =>]", "x = [a, ?]", "x = [a, else]", "x = [<T>:]", "x = [!:]", "x = [(a, :)]", "x = [a[:]]", "x = [`${a, :}`]",
  "x = [function () { a, : }]", "x = [() => { f(a, b), : }]", "x = [a, (b, :)]", "f(a[:])", "f((a, :))", "f(a, b[c, :])", "import(a, :)", "import(a, b, :)", "import((:))", "x = [a, /x/, :]", "x = [a, `b`, :]",
  "x = [a, b ? :]", "x = [a, b =]", "x = [a,\n:]", "f(a,\n:)", "x = [a, @]", "f(@)", "f(#a)", "x = [#a]", "x = [a, case]", "x = [a, instanceof b]", "f(a, instanceof b)", "f(a, as)", "f(a, >)", "x = [a, >]", "x = [a, /]", "f(a, %=)", "x = [a, +=]",
]),
g("declaration lists: where the list ends", [
  "{ var }", "{ var a, }", "var }", "var a, }", "var\n)", "var a,\n)", "var a,\nif (x) {}", "var a,\nfoo()", "var a,\nclass C {}", "var a,\n1", "var a, in", "for (var a, in x) {}", "for (var a, of x) {}", "for (var in x) {}",
  "for (var of x) {}", "for (var ;;) {}", "for (var a, ;;) {}", "if (x) var }", "if (x) var ;", "namespace N { var }", "function f() { var a, }", "var /* c */ ;", "var a /* c */ , /* d */ ;", "let ;", "let a, ;", "const ;", "using ;", "using a = 1, ;",
  "var a, ;x", "var ; var ;", "export var ;", "declare var ;", "var a, =>", "var =>", "var a, #b", "var #b", "var [#a] = x", "var {a: #b} = x", "try {} catch (#a) {}", "function f(#a) {}", "function f([#a]) {}",
]),
g("type parameters: where the list ends", [
  "function f<>() {}", "function f<T,>() {}", "function f<T, >() {}", "function f<T, () {}", "function f<T, { }", "class C<T, extends D {}", "class C<T, implements D {}", "class C< extends D {}", "type T<U, = 1", "type T<U",
  "type T<U,", "type T<", "type T<in> = 1", "type T<const> = 1", "type T<in :> = 1", "type T<in class> = 1", "function f<T extends>() {}", "function f<T = >() {}", "class C<T U> {}", "class C<T, U V> {}", "interface I<> {}", "type T<> = 1", "class C<> {}", "x = <>() => 1",
]),
g("class members: decorators, keywords and names", [
  "class C { @dec ) }", "class C { @dec }", "class C { @dec ; }", "class C { @dec @dec2 ) }", "class C { @dec /* c */ ) }", "class C { @dec\n) }", "class C { public ) }", "class C { get ) }", "class C { async ) }", "class C { * ) }",
  "class C { static * ) }", "class C { get * }", "class C { const x = 1 }", "class C { var x }", "class C { let x }", "class C { declare ) }", "class C { interface x }", "class C { interface { } }", "class C { type x }", "class C { type = 1 }", "class C { is x }",
  "class C { module x }", "class C { module { } }", "class C { namespace 1 }", "class C { cosnt x }", "class C { clas x }", "class C { varfoo x }", "class C { x y }", "class C { #x y }", "class C { [x] y }", "class C { 'x' y }", "class C { 1 y }",
  "class C { x: number\n(y) }", "class C { x: {}\n(y) }", "class C { x!(y) }", "class C { x! (y) }", "class C { x?: number (y) }", "class C { x: number @dec y }", "class C { x: number\n@dec y }", "class C { x = 1 (y) }",
  "class C { foo() {} ( }", "class C { ( }", "class C { x; ( }", "class C { x: number; ( }", "class C { get x() bar }", "class C { set x(v) bar }", "class C { static get x() bar }", "class C { get x(): number }", "class C { abstract get x(): number }",
  "class C { constructor() => }", "class C { m(): void => }", "abstract class C { abstract m() bar }", "declare class C { m() bar }", "declare class C { get x() bar }", ["js", "class C { get x() bar }"], ["js", "class C { m() bar }"], ["js", "class C { constructor() bar }"],
  ["js", "x = { m() bar }"], ["js", "x = function () bar"], ["js", "function f() bar"], ["js", "async function f() bar"], ["js", "export default function () bar"], ["js", "x = () => bar baz"],
]),
g("statements: the end of the file and switch", [
  "{", "{ foo;", "function f() {", "if (x) {", "if (x)", "if (x) foo; else", "while (x)", "for (;;)", "label:", "do", "do {} while (x", "switch (x) { case 1:", "switch (x) { case 1: foo;", "switch (x) { default:", "switch (x) {", "switch (x)",
  "switch (x) { case 1: { ) } }", "switch (x) { case 1: default: ) }", "switch (x) { case 1: foo bar }", "switch (x) { case 1: var ; }", "switch (x) { case 1: class C { ) } }", "switch (x) { case 1: x = [:] }", "switch (x) { case 1: f(:) }",
  "switch (x) { case 1: try {} foo }", "switch (x) { case 1: enum E { A B } }", "try {} catch", "try {} catch foo", "try {} catch ( {", "try {} catch () {}", "try {} catch (e) finally {}", "try {} finally", "try {} finally {} foo",
  "namespace N {", "namespace N { ) }", "class C { static {", "class C { static { ) } }", "x = () => {", "x = () => { ) }", "x = function () { ) }", "x = { m() { ) } }", "label: )", "if (x) )", "else", "case 1:", "default:", "finally {}", "catch {}",
]),
g("import and export: the line of with and assert", [
  'export * from "y"\nwith { type: "json" };', 'export { a } from "y"\nwith { type: "json" };', 'export type { a } from "y"\nwith { type: "json" };', 'export * as ns from "y"\nwith { type: "json" };', 'export type * from "y"\nwith { type: "json" };',
  'import "y"\nwith { type: "json" };', 'import x from "y"\nwith { type: "json" };', 'import type x from "y"\nwith { type: "json" };', 'import type { a } from "y"\nwith { type: "json" };', 'import x from "y"\nwith (a) {}', 'import x from "y"\nwith\n{ type: "json" };',
  'import x from "y"\nassert { type: "json" };', 'export * from "y"\nassert { type: "json" };', 'import x from "y" assert\n{ type: "json" };', 'export * from "y" assert\n{ type: "json" };', 'export * from "y" with\n{ type: "json" };',
  'export { a }\nwith { type: "json" };', 'export { a } with { type: "json" };', 'export { a } assert { type: "json" };', 'import x = require("y") with { type: "json" };', 'export * from "y" assert { type: "json" } foo;', 'import x from "y" assert { : };',
]),
require("node:fs").writeFileSync(__dirname + "/inputs2.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
