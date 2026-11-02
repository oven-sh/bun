// A literal with a lone setter is assigned a rest object that holds the name.
const more = { b: () => "called" };
const { drop, ...rest } = { drop: 0, a: 1, ...more };
function main() {
  const r = Object.assign({ set b(x) { console.log("b", typeof x, (typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x)); }, set 0(x) { console.log("0", typeof x, (typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x)); } }, rest);
  const x = r.kept ?? r.b ?? r[0];
  console.log(typeof x, (typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x), typeof r.a);
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}
