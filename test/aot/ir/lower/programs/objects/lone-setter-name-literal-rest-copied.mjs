// RUN: lower
// OPTIONS: builtin-modules

// A lone setter under a name, literal, rest of spread is copied in behind the setter, spread.
const more = { v: () => "called" };
const held = { b: more.v };
const { drop, ...rest } = { drop: 0, a: 1, ...held };
const text = x => typeof x + " " + String(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x);
function show(r) {
  const x = r.kept ?? r.b;
  console.log(text(x), typeof r.a, typeof r.kept);
}
function main() {
  const r = { set b(x) { this.kept = x; }, ...rest };
  show(r);
  show({ ...r });
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}

// CHECK-LABEL: function {{*}}name="main"
// CHECK-LABEL: function {{*}}name="text"
// CHECK-LABEL: function {{*}}name="b"
