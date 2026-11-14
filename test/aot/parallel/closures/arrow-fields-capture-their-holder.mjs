// Arrow functions in fields that captured `this`: called off their holder, off another object, exchanged before and inside the loop, inherited, chained, with stores through both names.
const out = [];
class T { constructor(n) { this.n = n; this.m = 0; this.add = x => { this.n += x; return this; }; this.swap = o => { [this.add, o.add] = [o.add, this.add]; return this; }; } }
class F { n = 0; m = 0; add = x => { this.n += x; this.m++; return this; }; }
class U extends T { constructor() { super(0.5); this.extra = 1; } }
function chain(o, turns) { for (let k = 0; k < turns; k++) o.add(k & 3).add(1); return o.n; }
function both(o, p, turns) { let t = 0; for (let k = 0; k < turns; k++) { o.add(k & 3); t += o.n - p.n; p.n = k; } return t; }
function changes(o, p, turns) { let t = 0; for (let k = 0; k < turns; k++) { t += o.add(1) === o ? 1 : 100; if (k === 7) o.add = p.add; } return t; }
const own = new T(0), first = new T(1), second = new T(2), field = new F(), sub = new U();
out.push(chain(own, 40), chain(field, 40), field.m, chain(sub, 40), chain(new T("t"), 3), chain(new T(-0), 1));
first.swap(second);
out.push(chain(first, 40), first.n, second.n, both(first, second, 20), both(own, own, 20), both(first, first, 20));
out.push(changes(new T(0), new T(5), 20), changes(first, second, 20), first.n, second.n);
second.add = x => { first.n -= x; return second; };
out.push(chain(second, 10), first.n, second.n);
const accessor = new T(3); let stored = 0;
Object.defineProperty(accessor, "n", { get: () => 4, set(v) { stored += v; } });
out.push(chain(accessor, 10), stored);
const frozen = Object.freeze(new T(6)); try { chain(frozen, 2); } catch (e) { out.push(e.constructor.name, frozen.n); }
const bare = new T(7); delete bare.add; try { chain(bare, 2); } catch (e) { out.push(e.constructor.name); }
console.log(out.join(" "));
