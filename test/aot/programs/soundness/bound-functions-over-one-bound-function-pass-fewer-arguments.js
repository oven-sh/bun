// One call site calls three bound functions over one bound function with two, two and one argument: the last leaves the second parameter undefined.
function f(a, b) { if (b === undefined) return "missing:" + a; return typeof b + ":" + a; }
function main() {
  const h = f.bind(null);
  const g1 = h.bind(null, 1, 2), g2 = h.bind(null, 2, "x"), g3 = h.bind(null, 3);
  let out = "";
  for (let i = 0; i < 3; i++) { const g = i === 0 ? g1 : i === 1 ? g2 : g3; out += g() + ";"; }
  return out;
}
console.log(main());
