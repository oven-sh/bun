// A function returns what it is given: a fraction to one caller, integers to an arrow that ends in a call of it. What the arrow returns is its next argument.
function out(l, v) { console.log(l, String(v)); }
function f(n) {
  if (n % 3 === 0) {
    out("p", "x");
    out("q", n);
  }
  return n;
}
const g = (p) => f(p);
out("r", f(0.5));
const t = g(11);
out("s", g(t));
