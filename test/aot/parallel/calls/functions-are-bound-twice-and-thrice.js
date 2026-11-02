// A bound function is named after what it binds AT THE BIND: "bound bound declared". The closure of a bound function is created with another name than its function is written with.
function declared(a, b, c) { return [a, b, c].join(); }
const arrow = (a, b, c) => [a, b, c].join();
class Holder { method(a, b, c) { return [a, b, c].join(); } }
const lines = [];
for (let i = 0; i < 3; i++) {
  const once = declared.bind(null), twice = declared.bind(null).bind(null, 1, 2), thrice = declared.bind(null, 1).bind(null, 2).bind(null, 3);
  lines.push([once.name, once.length, twice.name, twice.length, twice(9), thrice.name, thrice.length, thrice()].join(" | "));
  const a2 = arrow.bind(null, 1).bind(null, 2); lines.push([a2.name, a2.length, a2(3)].join(" | "));
  const h = new Holder(); const m2 = h.method.bind(h, 1).bind(null, 2); lines.push([m2.name, m2.length, m2(3)].join(" | "));
}
console.log(lines.join("\n"));
