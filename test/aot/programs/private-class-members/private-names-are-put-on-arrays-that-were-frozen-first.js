// A private name is no property, so an object that was frozen takes one: through a base constructor that answers the object it was handed. Arrays of every kind of storage stay frozen arrays behind it.
class Base { constructor(o) { return o; } }
class Stamp extends Base {
  #n = 1;
  #method() { return "method " + this.#n; }
  get #accessor() { return this.#n * 2; }
  constructor(o) { super(o); }
  static has(o) { return [#n in o, #method in o, #accessor in o].join(); }
  static touch(o) { return ++o.#n + " " + o.#method() + " " + o.#accessor; }
}
function said(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const makers = [["numbers", () => [1, 2]], ["doubles", () => [1.5, 2.5]], ["strings", () => ["a", "b"]], ["empty", () => []], ["holes", () => [1, , 3]], ["long", () => Array.from({ length: 100 }, (_, i) => i)]];
for (const [title, create] of makers) {
  const o = Object.freeze(create());
  const before = JSON.stringify(o);
  console.log(title, said(() => new Stamp(o) === o), Stamp.has(o), said(() => Stamp.touch(o)), said(() => Stamp.touch(o)), said(() => new Stamp(o)));
  console.log(title, Object.isFrozen(o), Array.isArray(o), o.length, JSON.stringify(o) === before, Object.keys(o).length, Reflect.ownKeys(o).length, said(() => { "use strict"; o[0] = 9; return "stored"; }), said(() => { "use strict"; o.push(1); return "pushed"; }), said(() => { "use strict"; o.length = 0; return "cut"; }), said(() => { "use strict"; o.extra = 1; return "added"; }), said(() => { "use strict"; delete o[0]; return "deleted"; }));
  let total = 0;
  for (let i = 0; i < o.length; i++) total += typeof o[i] === "number" ? o[i] : 1;
  console.log(title, total, o.map(x => x).length, [...o].length, o.slice(1).length, o.indexOf(o[o.length - 1]), o.concat([1]).length);
}
