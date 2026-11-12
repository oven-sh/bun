// Bound functions kept in tables and called through them
const base = {
  factor: 3,
  scale(n, m = 1) {
    return n * this.factor * m;
  },
};
const table = { plain: base.scale.bind(base), twice: base.scale.bind({ factor: 6 }), fixed: base.scale.bind(base, 10) };
function run(n) {
  const out = [];
  for (const name in table) out.push(name[0] + table[name](n) + table[name].call({ factor: 0 }, n, 2));
  const bound = (function () { return this.n + [].slice.call(arguments).length; }).bind({ n }, 1, 2);
  return out.join() + " " + bound(3) + " " + bound.length + table.fixed.length + " " + table.twice.name;
}
console.log(run(1));
console.log(run(20));
console.log(run(0));
