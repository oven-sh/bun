// A lone setter under a name, literal, rest is copied in behind the setter, for in.
const more = { v: () => "called" };
const { drop, ...rest } = { drop: 0, a: 1, b: more.v };
const text = x => typeof x + " " + String(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x);
function show(r) {
  const x = r.kept ?? r.b;
  console.log(text(x), typeof r.a, typeof r.kept);
}
function main() {
  const r = { set b(x) { this.kept = x; }, ...rest };
  show(r);
  for (const key in r) console.log(key, text(r[key]));
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
