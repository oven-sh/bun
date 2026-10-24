// What a species constructor returns arrives in the result after the built-in has been looked at, and gets the elements all the same.
function run(f) { "x".replace("x", f); }
class Rows extends Array {}
class Boxed extends Array { static get [Symbol.species]() { return Holder; } }
function Holder(n) { this.made = "by species"; this.length = 0; }
function main() {
  const r = new Rows();
  r.push({ a: 1 }, { a: 2 });
  const s = r.slice(0, 1);
  console.log(s instanceof Rows, s.length, s[0].a);
  const c = r.concat([{ a: "x" }]);
  console.log(c instanceof Rows, c.length, typeof c[2].a);
  const b = new Boxed();
  b.push({ a: "boxed" });
  const t = b.slice(0);
  console.log(t instanceof Holder, t.made, typeof t[0], t[0].a);
  let source = r;
  function swap() { source = b; return ""; }
  for (let i = 0; i < 2; i++) { const copy = source.slice(0); console.log(copy instanceof Array, typeof copy[0].a, typeof copy.made); run(swap); }
}
main();
