// Instances of classes below a mixin that is evaluated over Object, over a class and over Array.
const key = ["b", "c"][0];
function mix(Base) {
  if (Base === undefined) Base = Object;
  class Mixed extends Base {
    total() { return this.get(0) + this.get(1); }
    set(v) { this.a = v; return this; }
  }
  return Mixed;
}
class Plain { constructor() { this.plain = 1; } }
class Other {}
class View extends mix() {
  constructor(list, a) { super(); this.list = list; this.a = a; }
  get(i) { return this.list[i]; }
}
class Wide extends View {
  extra = 5;
  #own = 2;
  constructor(list, a) { super(list, a); this[key] = a; }
  get(i) { return super.get(i) + this.#own; }
}
class Below extends mix(Plain) { constructor(a) { super(); this.a = a; } get(i) { return this.a + i; } }
class List extends mix(Array) { constructor(a) { super(2); this[0] = a; this[1] = a; this.a = a; } get(i) { return this[i]; } }
class Odd extends mix(function () { return { odd: 1 }; }) { constructor() { super(); this.a = 1; } get() { return 1; } }
function show(o) {
  console.log(Object.prototype.toString.call(o), Object.keys(o).join(), JSON.stringify(o), o instanceof View, Object.getPrototypeOf(o) === o.constructor.prototype);
}
function sum(list) {
  let t = 0;
  for (const o of list) for (let i = 0; i < 3; i++) t += o.total() + Number(o.a) + i;
  return t;
}
const all = [new View([1, 2], 3), new Wide([4, 5], 6), new Below(7), new List(8)];
for (const o of all) show(o);
console.log(sum(all));
for (const o of all) o.set(1.5);
console.log(sum(all), new Odd().odd);
all[0].late = "late"; delete all[1].a; Object.freeze(all[2]);
Object.defineProperty(all[3], "a", { get: () => 4 });
for (const o of all) show(o);
console.log(Object.isFrozen(all[2]), "a" in all[1]);
const made = Reflect.construct(View, [[1, 1], 2], Other);
console.log(made instanceof Other, made instanceof View, Object.keys(made).join(), made.a);
View.prototype.get = function (i) { return -i; };
Object.defineProperty(Object.getPrototypeOf(View.prototype), "a", { get() { return 9; }, set(v) { this.hidden = v; }, configurable: true });
const behind = new View([3, 3], 4);
show(behind);
console.log(behind.total(), behind.a, behind.hidden, Object.getOwnPropertyNames(behind).join());
for (let i = 0; i < 50; i++) all.push(new View([i, i], i));
console.log(all.length, all.slice(4).reduce((t, o) => t + o.total() + o.a, 0));
