// An own property that hides the class's method, stored behind the first call (Hono's SmartRouter.match).
class Router {
  constructor(name) { this.name = name; }
  match(x) { const inner = new Inner(this.name); this.match = inner.match.bind(inner); return 'method ' + x; }
  get size() { return 1; }
}
class Inner {
  constructor(name) { this.name = name; }
  match(x) { return 'inner ' + this.name + ' ' + x; }
}
function ask(o, i) { return o.match(i) + ' | ' + typeof o.match + ' | ' + o.size + ' | ' + o.nothing + ' | ' + Object.keys(o).join(); }
const routers = [new Router('a'), new Router('b')];
for (let i = 0; i < 40; i++) {
  const r = routers[i & 1];
  const line = ask(r, i);
  if (i < 6 || i > 37) console.log(line);
}
const read = (o) => o.match;
for (let i = 0; i < 40; i++) { const f = read(i & 1 ? routers[0] : new Router('c')); if (i > 37) console.log(f.name, f === Router.prototype.match); }
