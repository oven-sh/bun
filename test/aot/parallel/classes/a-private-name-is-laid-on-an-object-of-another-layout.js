// A constructor whose parent returns what it is handed lays its private name on a literal, on an instance of another class and on a list. The class is evaluated twice, and each evaluation has a name of its own.
// Under: --aot-testing=CheckProofsAtRunTime: a private name is no field that is appended
function handBack(o) { return o; }
function makeStamp() {
  return class Stamp extends handBack {
    #mark;
    constructor(o, mark) { super(o); this.#mark = mark; }
    static has(o) { return #mark in o; }
    static read(o) { return o.#mark; }
    static write(o, mark) { o.#mark = mark; }
  };
}
class Other { constructor() { this.a = 1; } }
const One = makeStamp();
const Two = makeStamp();
const lines = [];
function attempt(f) { try { lines.push(String(f())); } catch (error) { lines.push(error.constructor.name); } }
for (const target of [{ a: 1 }, new Other(), [1, 2]]) {
  attempt(() => One.has(target));
  attempt(() => One.read(target));
  new One(target, 1.5);
  attempt(() => One.has(target) + " " + Two.has(target) + " " + One.read(target));
  attempt(() => Two.read(target));
  attempt(() => new One(target, 2));
  new Two(target, "two");
  One.write(target, { boxed: true });
  attempt(() => JSON.stringify(One.read(target)) + " " + Two.read(target));
  attempt(() => Reflect.ownKeys(target).join() + " " + JSON.stringify(target));
  attempt(() => One.has({ ...target }));
}
attempt(() => One.has(Object.freeze({ a: 1 })));
attempt(() => new One(Object.freeze({ a: 1 }), 3) && "a frozen object takes a private name");
console.log(lines.join("\n"));
