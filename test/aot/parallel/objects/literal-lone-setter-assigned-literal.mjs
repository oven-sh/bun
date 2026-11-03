// A literal with a lone setter is assigned a literal that spreads an instance with the name.
const more = { b: () => "called" };

function main() {
  const r = Object.assign({ set b(x) { this.kept = x; }, set 0(x) { this.kept = x; } }, { a: 1, ...new (class { b = more.b; })() });
  const x = r.kept ?? r.b ?? r[0];
  console.log(typeof x, (typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x), typeof r.a);
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
