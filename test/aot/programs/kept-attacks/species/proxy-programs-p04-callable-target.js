// Species: proxy programs  callable target. It prints what plain Bun prints.
const log = [];
function add(a, b) { log.push(typeof a + " " + typeof b + " " + (this === undefined ? "none" : typeof this)); return a + b; }
add(1, 2);
class Point { constructor(x) { log.push("new " + typeof x); this.x = x; } }
new Point(1);
const f = new Proxy(add, {}); const C = new Proxy(Point, {});
log.push(String(f("a", "b")), String(f.call({}, 1, "c")), String(new C("s").x), String(new C(2) instanceof Point));
const g = new Proxy(add, { apply(target, self, args) { log.push("apply " + args.length); return target(...args, true); } });
const D = new Proxy(Point, { construct(target, args, newTarget) { log.push("construct " + (newTarget === D)); return new target(null); } });
log.push(String(g(1)), String(new D(1).x));
console.log(log.join("; "));
