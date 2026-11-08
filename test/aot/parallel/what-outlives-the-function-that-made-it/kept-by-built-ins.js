const map = new Map(), set = new Set(), weak = new WeakMap(), list = [], target = {};
function fill(i) {
  const a = { v: i }, b = { v: i + 1 }, c = { v: i + 2 }, d = { v: i + 3 }, e = { v: i + 4 }, f = { w: i + 5 };
  map.set(a, b); set.add(c); weak.set(d, e); list.push(d); list.unshift(e); Object.assign(target, f, { g: { v: i + 6 } });
  return i;
}
fill(1);
console.log([...map].map(([k, v]) => k.v + ":" + v.v).join(), [...set][0].v, weak.get(list[1]).v, list[0].v, target.w, target.g.v);
