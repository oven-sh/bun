// The body of a function declaration can run only after a reference to its name has been evaluated.
const attempt = (what: string, run: () => unknown) => { try { console.log(what, String(run())) } catch (e) { console.log(what, (e as Error).constructor.name) } }
function direct() { attempt("direct early", g); let x = 1; function g() { return x } return g() }
function chain() {
  function a() { return b() } function b() { return c() } function c() { return y }
  attempt("chain early", a)
  let y = 2
  return a()
}
function late() { function a() { return b() } function b() { return z + n } let z = 3; var n = 10; return a() }
function never() { let u = 6; var m = 1; function unused() { return u + m } return u + m }
function arrow() { const early = () => h(); attempt("arrow early", early); let w = 4; function h() { return w } return early() }
function method() { const o = { m() { return k() } }; attempt("method early", () => o.m()); let v = 5; function k() { return v } return o.m() }
function byDefault() { function p(first = String(q)) { return first } const before = p(); var q = 7; return before + "," + p() }
function classField() { class C { f = r() } attempt("field early", () => new C().f); let s = 8; function r() { return s } return new C().f }
function block(flag: boolean) { function t() { return String(i) } if (flag) { var i = 9 } return t() }
function nested() { function outer() { function inner() { return j } return inner() } let j = 11; return outer() }
function cycle(n: number) { function even(k: number): boolean { return k == 0 ? base : odd(k - 1) } function odd(k: number): boolean { return k == 0 ? !base : even(k - 1) } let base = true; return even(n) }
function cycleEarly() { function ping(k: number): number { return k == 0 ? stop : pong(k - 1) } function pong(k: number): number { return ping(k) } attempt("cycle early", () => pong(2)); let stop = 12; return pong(2) }
function varEarly() { const seen = [peek()]; var l = 13; function peek() { return String(l) } seen.push(peek()); return seen.join(",") }
for (const run of [direct, chain, late, never, arrow, method, byDefault, classField, nested, cycleEarly, varEarly]) console.log(run.name, String(run()))
console.log("block", block(true), block(false), "cycle", cycle(4), cycle(5))
