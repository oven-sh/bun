const log = [];
class Base { constructor(a, b) { this.a = a; this.b = b; } }
const Watched = new Proxy(Base, { construct(target, list, newTarget) { log.push(list.length + ":" + newTarget.name); return Reflect.construct(target, list, newTarget); } });
class BelowProxy extends Watched {}
const Bound = Base.bind(null, "bound");
Bound.prototype = Base.prototype;
class BelowBound extends Bound {}
for (let i = 0; i < 3; i++) console.log(JSON.stringify([new BelowProxy(i, 2), new BelowBound(i)]), new BelowProxy() instanceof BelowProxy);
console.log(log.join());
