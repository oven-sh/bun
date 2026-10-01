// Inputs of the probe, part 4: the decision tree of a property that no semicolon ends, and of a token that starts no parameter.
// usage: node make-inputs4.cjs > inputs4.json
const out = [];
let group = "";
const g = name => { group = name; };
const t = (s, l) => out.push({ g: group, s, l: l || "ts" });
g("T1 class members: keyword names with and without modifiers before them");
for (const s of [
  "class C { declare type x }", "class C { abstract + }", "class C { public type x }", "class C { async + }",
  "class C { static type x }", "class C { any x }", "class C { of x }", "class C { get x y }", "class C { readonly type x }",
  "class C { declare + }", "class C { public const x }", "class C { const\n x }", "class C { export default x }",
  "class C { export * }", "class C { accessor + }", "class C { x?: number y }", "class C { 'a' 'b' }", "class C { [a] [b] }",
  "class C { static async x }", "class C { async\n x }", "class C { public interface x }", "class C { public interface {} }",
  "class C { static module x }", "class C { static namespace {} }", "class C { static is x }", "class C { static type = 1 }",
  "class C { static let x }", "class C { static var x }", "class C { public declare + }", "class C { override x y }",
  "class C { accessor x y }", "class C { static x y }", "class C { readonly x y }", "class C { abstract x y }",
  "class C { declare x y }", "class C { async x y }", "class C { async x() y }", "class C { get x() y }", "class C { set x(v) y }",
  "class C { constructor() y }", "class C { static {} y }", "class C { x = 1; y z }", "class C { string x }", "class C { number: x y }",
  "class C { yield x }", "class C { await x }", "class C { let }", "class C { let = 1 }", "class C { let() {} }", "class C { let\n x }",
  "class C { type\n x }", "class C { type; x }", "class C { if x }", "class C { new x }", "class C { in }", "class C { in = 1 }",
  "class C { static abstract x y }", "class C { abstract static x y }", "class C { declare abstract type x }",
  "class C { @d type x }", "class C { @d x y }", "class C { x: number = 1 (2) }", "class C { x: () => void (1) }",
  "class C { x = y\n(1) }", "class C { x: number\n(1) }", "class C { x\n(1) {} }", "class C { get\n x() { return 1 } }",
  "class C { public x = 1 y }", "class C { x: number @d }", "class C { x\n @d y }", "class C { accessor x @d y }",
  "class C { m() {} x y }", "class C { 1 2 }", "class C { 1n x }", "class C { #a #b }", "class C { x: A B }",
  "class C { x: A<B> C }", "class C { x: A.B C }", "class C { x: typeof a b }", "class C { x: A | B c }", "class C { x?: A b }",
  "class C { x!: A b }", "class C { x! = 1 b }", "class C { readonly x: A b }", "declare class C { x: A b }",
]) t(s);
g("T2 parameters: what starts none, and modifiers before this");
for (const s of [
  "function f(public readonly this) {}", "function f(@a @b this) {}", "function f(@d public this) {}", "function f(public @d this) {}",
  "function f(export x) {}", "function f(in x) {}", "function f(export default x) {}", "function f(void) {}", "function f(typeof) {}",
  "function f(new) {}", "function f(null) {}", "function f(true) {}", "function f(import) {}", "function f(if x) {}", "function f(;) {}",
  "function f(=) {}", "function f(?) {}", "function f(<T>) {}", "function f(*) {}", "function f(|) {}", "function f(&) {}",
  "function f(!) {}", "function f(~) {}", "function f(+) {}", "function f(.) {}", "function f(:) {}", "function f(=>) {}",
  "function f(`a`) {}", "function f(1n) {}", "function f(/) {}", "function f(a, ) {}", "function f(a, ;) {}", "function f(a, class) {}",
  "function f(a, #b) {}", "function f(a, -b) {}", "function f(a, 1) {}", "function f(a;) {}", "function f(a", "function f(a, b",
  "function f(a: number,", "function f(...", "function f(...a", "function f(...a,", "function f(@d", "function f(public",
  "function f(public x", "function f(this", "function f(this,", "class C { m(", "class C { constructor(public", "(function(", "({ m(",
  "function f(static this) {}", "function f(async this) {}", "function f(...this) {}", "function f(this this) {}",
  "function f(a, public this) {}", "function f(this: A, public b) {}", "class C { constructor(private readonly this) {} }",
  "function f(public static x) {}", "function f(static public x) {}", "function f(static static x) {}", "function f(declare async x) {}",
  "function f(public x, public y) {}", "function f(accessor accessor x) {}", "function f(public 1n) {}", "function f(public *) {}",
  "function f(public #x) {}", "function f(public public) {}", "function f(public static) {}", "function f(readonly: number, public) {}",
  "function f(yield) {}", "function f(await) {}", "function f(let) {}", "function f(of, as, type) {}", "function f(enum) {}",
  "function f(a = 1, ...b = 2) {}", "function f(...a: any[], b?: number) {}", "function f(...a?, b) {}", "function f([a]?, {b}?) {}",
  "function f({a} = {}, [b] = []) {}", "function f(public {a} = {}) {}", "declare function f(...a, b): void;", "declare function f(...a,): void;",
  "class C { m(...a,): void; m(...a: any[]) {} }", "function f(...a,): void; function f(...a: any[]) {}",
]) t(s);
process.stdout.write(JSON.stringify(out, null, 0) + "\n");
