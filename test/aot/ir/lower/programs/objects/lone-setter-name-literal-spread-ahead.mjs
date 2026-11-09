// RUN: lower
// OPTIONS: builtin-modules

// A lone setter under a name, literal, spread of instance is copied in ahead of the setter, entries.
const more = { v: () => "called" };
const text = x => typeof x + " " + String(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x);
function show(r) {
  const x = r.kept ?? r.b;
  console.log(text(x), typeof r.a, typeof r.kept);
}
function main() {
  const r = { ...{ a: 1, ...new (class { b = more.v; })() }, set b(x) { this.kept = x; } };
  show(r);
  r.b = 5;
  show(r);
  for (const [key, value] of Object.entries(r)) console.log(key, text(value));
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}

// CHECK-LABEL: function {{*}}name="main"
// CHECK-LABEL: function {{*}}name="b"
