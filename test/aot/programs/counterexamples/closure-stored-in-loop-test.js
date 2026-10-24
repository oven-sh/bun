// `h.f = g` in the test of a loop stores to the object that h names in that iteration.
function run(h, b, g) {
  while ((h.f = g, h != b)) { const k = h; h = b; g = () => k; }
}
const a = {}, b = {};
run(a, b, 0);
console.log(typeof a.f, typeof b.f);
