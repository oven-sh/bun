// `o.tag = a` names what no class has and `o.label` is asked on one way alone: by `width` and `height` the functions expect a Box. What comes out of JSON, out of another class and out of a proxy has those names too.
// Under: --aot-testing=CheckProofsAtRunTime: nothing is proven here, an expectation is tested where it is used
class Box { constructor(width, height) { this.width = width; this.height = height; } }
class Crate { constructor() { this.height = 3; this.width = 4; this.label = "crate"; } }
function tagged(o) { const a = o.width * o.height; o.tag = a; return a; }
function first(o) { const a = o.width * o.height; if (a) return a; return o.label; }
const lines = [];
const told = [];
const values = [new Box(1, 2), JSON.parse('{"width":5,"height":6}'), new Crate(), new Box(0, 2), JSON.parse('{"height":"x","width":2,"label":"parsed"}'),
  new Proxy(new Box(7, 8), { get(target, name) { told.push("get " + String(name)); return target[name]; }, set(target, name, value) { told.push("set " + String(name)); target[name] = value; return true; } }),
  Object.assign(Object.create(new Box(9, 10)), { label: "below a box" }), new Box(11, 12)];
for (let turn = 0; turn < 2; turn++)
  for (const value of values) lines.push(String(tagged(value)) + " " + String(first(value)) + " " + Object.keys(value).join());
console.log(lines.join("\n"));
console.log(told.join());
