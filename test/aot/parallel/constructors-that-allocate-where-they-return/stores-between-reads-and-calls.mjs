// A constructor that passes its object to nobody allocates it where it returns. Nothing of that shows.
let ticks = 0;
const tick = value => { ticks++; return value; };
const kept = [];
const keys = object => Reflect.ownKeys(object).map(String).join(",");
const show = (label, object) => console.log(label, keys(object), Object.values(object).map(value => value === object ? "self" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? value.constructor.name : String(value)).join(","), Object.getPrototypeOf(object).constructor.name);

class Color { constructor(red, green) { this.red = red; this.green = green; } }
class Info {
  constructor() { this.hit = false; this.count = 0; this.shape = null; this.color = Info.defaultColor; this.distance = null; }
}
Info.defaultColor = new Color(0, 0.5);
for (let i = 0; i < 3; i++) { const info = new Info(); info.distance = i + 0.5; info.hit = i > 1; show("info", info); console.log(info.color === Info.defaultColor); }
Info.defaultColor = null; show("null", new Info());
Info.defaultColor = "text"; show("text", new Info());
Object.defineProperty(Info, "defaultColor", { get() { tick(); Object.defineProperty(Info.prototype, "distance", { set(value) { kept.push(value); }, configurable: true }); return undefined; }, configurable: true });
show("a setter laid between the stores", new Info()); console.log(kept.join(), ticks);
delete Info.prototype.distance; kept.length = 0;

class Thrower { constructor(fails) { this.a = tick(1); if (fails) throw new Error("no object"); this.b = tick(2); } }
for (const fails of [false, true]) { try { show("thrower", new Thrower(fails)); } catch (error) { console.log(error.message, ticks); } }

class Early { constructor(x) { this.a = x; kept.push(this); this.b = tick(x); this.self = this; } }
const early = new Early(4); show("early", early); console.log(kept[0] === early, early.self === early);

class Guarded { constructor(x) { this.a = 1; try { this.b = x.y.z; } catch { this.b = -0; } this.c = tick(this.b); } }
for (const x of [undefined, { y: { z: 7 } }]) show("guarded", new Guarded(x));

class Parted { constructor(x) { this.a = x; if (x > 1) this.b = x * 2; else this.c = "less"; this.d = 1.5; } }
for (const x of [0, 1, 2, 3]) show("parted", new Parted(x));

class Counted { constructor(n) { this.sum = 0; for (let i = 0; i < n; i++) this.sum += i; this.n = n; } }
for (const n of [0, 1, 10]) show("counted", new Counted(n));

class Base { first = tick(1); #hidden = tick(2); constructor(x) { this.x = x; this.name = new.target.name; } get hidden() { return this.#hidden; } }
class Derived extends Base { second = this.first + 1; constructor(x, y) { tick(0); super(y); this.y = y; this.sum = this.x + this.second; } }
class Returning extends Base { constructor(x) { super(x); if (x === 2) return { other: true }; this.last = x; } }
for (const x of [1, 2.5, "t"]) { const derived = new Derived(x, x); show("derived", derived); console.log(derived.hidden, derived instanceof Base); }
for (const x of [1, 2]) show("returning", new Returning(x));
show("reflect", Reflect.construct(Base, [9], Derived));
show("other target", Reflect.construct(Color, [1, 2], Array));

class Closed { constructor(x) { this.x = x; this.get = () => this.x; this.y = tick(x); } }
const closed = new Closed(3); closed.x = 5; console.log(closed.get(), keys(closed));

class Frozen { constructor(x) { this.x = x; Object.freeze(this); } }
const frozen = new Frozen(1); try { frozen.x = 2; } catch (error) { console.log(error.constructor.name, frozen.x); }

class Twice { constructor(x) { this.x = 0; this.y = x; this.x = x; delete this.y; this.z = this.x; } }
show("twice", new Twice(6));

const local = [1, 2].map(n => class Local { constructor(x) { this.n = n; this.x = tick(x); this.next = null; } });
for (const Local of local) show("local", new Local(8));

const list = []; for (let i = 0; i < 100; i++) { const color = new Color(i, -i); list.push(color); color.red += 0.25; }
console.log(list.reduce((sum, color) => sum + color.red + color.green, 0), ticks);
