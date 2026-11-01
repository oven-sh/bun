// Extends a bound function: compiled answers as plain. A bound function has no `prototype`, so the class declaration itself throws.
function F(a, b) {
  this.a = a;
  this.b = b;
}
const G = F.bind(null, 1);
try {
  class H extends G {}
  const h = new H(2);
  console.log(h.a, h.b, h instanceof F, h instanceof H);
} catch (e) {
  console.log(e.constructor.name);
}
G.prototype = F.prototype;
try {
  class H extends G {}
  const h = new H(2);
  console.log(h.a, h.b, h instanceof F, h instanceof H);
} catch (e) {
  console.log(e.constructor.name);
}
