// Writes inputs6.json: rows that check which list owns a token. usage: node make-inputs6.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
const B = "\\";
g("which list owns the token", [
  "enum E { A,", "enum E {", "x = [(a, :)]", "x = [a[b, :]]", "f(a, (b, :))", "f(a[b, :])", "f(a, b[:])", "x = [a[:]]", "x = [`${a, :}`]", "x = [function () { a, : }]", "x = [() => a, :]", "x = [f(a, :)]", "x = [f(:)]",
  "x = [{a: :}]", "x = [{a, :}]", "x = [[a, :]]", "x = [a, ...:]", "x = [a ? b : ]", "x = [a ? b, :]", "f(a ? b : )", "f(a = )", "f(a, b = :)", "x = [a = :]", "x = [a, b = :]", "x = [await, :]", "x = [yield, :]", "x = [new A, :]",
  "x = [a as T, :]", "x = [<T>a, :]", "x = [a!, :]", "x = [class {}, :]", "x = [function () {}, :]", "x = [a /* c */, /* d */ :]", "x = [a,\n:]", "x = [\n:]", "f(\n/* c */ :)", "x = [import(:)]", "x = import(:)", "x = import(a, :)",
  "try {} catch (:) {}", "try {} catch (class) {}", "try {} catch ([:]) {}", "try {} catch ({:}) {}", "try {} catch (a, b) {}", "try {} catch (...a) {}", "try {} catch (1) {}", "f(,)", "f(a,,b)", "new A(,)", "var {a: :} = x", "var {a: class} = x",
  "var {[a]: :} = x", "var [{a: :}] = x", "var [a = :] = x", "var {a = :} = x", "function f(a = (b, :)) {}", "function f(a = [b, :]) {}", "function f([a = function () { try {} catch (:) {} }]) {}", "function f(a = function (:) {}) {}",
  "function f(a, [b, :]) {}", "function f(a, {b, :}) {}", "function f(a, ...:) {}", "function f(a, ...[b, :]) {}", "var a = [b, :], c", "var a = f(:), c", "var [a, [b, :]] = x", "var [a, {b, :}] = x", "var {a: [b, :]} = x", "var {a: {b, :}} = x",
  "class C { m(a, [b, :]) {} }", "class C { x = [a, :] }", "class C { x = f(:) }", "class C { [f(:)]() {} }", "class C { static { f(:) } }", "x = { a: [b, :] }", "x = { a: f(:) }", "x = { [f(:)]: 1 }", "x = { a(b, :) {} }", "x = { ...[a, :] }",
  "switch (x) { case [a, :]: }", "switch (x) { case f(:): }", "if ([a, :]) {}", "for ([a, :];;) {}", "for (var a = [b, :];;) {}", "for (var [a, :] of x) {}", "for (x of [a, :]) {}", "while (f(:)) {}", "return [a, :]", "throw f(:)", "x = `${[a, :]}`", "x = `${f(:)}`",
  "type T = A<[b, :]>", "type T = (a: [b, :]) => void", "let x: typeof f<[a, :]>", "x = f<[a, :]>()", "x = a as [b, :]", "x = <[a, :]>y", "class C<T = [a, :]> {}", "function f<T extends [a, :]>() {}",
  ["js", "f(:)"], ["js", "x = [a, :]"], ["js", "x = {a, :}"], ["js", "function f(a, :) {}"], ["js", "var a, :"], ["js", "var [a, :] = x"], ["js", "var {a, :} = x"], ["js", "class C { : }"], ["js", "switch (x) { case 1: ) }"], ["js", "try {} foo"],
  ["tsx", "f(:)"], ["tsx", "x = [a, :]"], ["tsx", "x = <a b={[c, :]}/>"], ["tsx", "x = <a b={f(:)}/>"], ["tsx", "x = <a>{[c, :]}</a>"], ["jsx", "x = <a b={f(:)}/>"],
  ["dts", "declare function f(a, :): void;"], ["dts", "enum E { A B }"], ["dts", "var a, :"], ["dts", "class C { : }"],
]);
require("node:fs").writeFileSync(__dirname + "/inputs6.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
