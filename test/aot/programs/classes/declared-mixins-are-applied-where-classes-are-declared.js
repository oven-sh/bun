// With declared functions: Functions that return a class are called where other classes are declared. Each call evaluates the class anew: with its own private names, static fields, prototype object and base.
const lines = [];
const attempt = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
class Base { id = 1; who() { return "base"; } static made = 0; }
class Other { width = 2; who() { return "other"; } }
function Timed(Parent) { return class extends Parent {
  started = 5; #ticks = 0; static kind = "timed"; static count = 0;
  constructor(...list) { super(...list); new.target.count++; }
  tick() { return ++this.#ticks + this.started; }
  who() { return "timed>" + super.who(); }
  static has(object) { return #ticks in object; }
  static peek(object) { return object.#ticks; }
  get ticks() { return this.#ticks; }
  #hidden() { return "hidden " + this.#ticks; }
  reveal() { return this.#hidden(); }
}; }
function Tagged(Parent) { return class Tag extends Parent {
  tag = "t"; static kind = "tagged";
  size() { return this.tag.length + (this.id ?? 0); }
  who() { return "tagged>" + super.who(); }
  static self() { return Tag; }
}; }
class A extends Timed(Base) {}
class B extends Tagged(Timed(Base)) { who() { return "B>" + super.who(); } }
class C extends Timed(Tagged(Other)) {}
class D extends Timed(Timed(Base)) {}
const Loose = Timed(Other);
const inLoop = [];
for (const Parent of [Base, Other, A]) inLoop.push(Timed(Parent));

const all = { A, B, C, D, Loose, first: inLoop[0], second: inLoop[1], third: inLoop[2] };
for (const [name, Class] of Object.entries(all)) {
  const object = new Class();
  object.tick(); object.tick();
  lines.push(name + ": " + [object.who(), object.tick(), object.ticks, object.reveal(), Object.keys(object).join("/"), Class.kind, Class.count, Class.name, Object.getPrototypeOf(Class).name, attempt(() => object.size?.())].join(" | "));
}
// The private names of one evaluation are unknown to the others.
const parents = Object.fromEntries(Object.entries(all).map(([name, Class]) => [name, name.length === 1 ? Object.getPrototypeOf(Class) : Class]));
const table = [];
for (const [asking, Class] of Object.entries(parents)) {
  if (typeof Class.has !== "function") { table.push(asking + ":-"); continue; }
  table.push(asking + ":" + Object.values(all).map((Made) => (Class.has(new Made()) ? 1 : 0)).join(""));
}
lines.push(table.join(" "));
lines.push(attempt(() => parents.A.peek(new C())), attempt(() => parents.A.peek(new A())), attempt(() => parents.C.peek(new A())), attempt(() => parents.A.prototype.tick.call(new C())), attempt(() => parents.A.prototype.reveal.call(new Loose())), attempt(() => parents.A.peek({})));
// Two evaluations over each other: each has its own counter in the one object.
const twice = new D();
const upper = Object.getPrototypeOf(D), lower = Object.getPrototypeOf(upper);
twice.tick();
lines.push([upper.peek(twice), lower.peek(twice), lower.prototype.tick.call(twice), upper.peek(twice), lower.peek(twice), upper === lower, upper.has(twice) && lower.has(twice)].join());
// Static fields belong to the evaluation.
parents.A.kind = "changed";
lines.push([parents.A.kind, parents.C.kind, Loose.kind, A.kind, Object.hasOwn(A, "kind"), Object.hasOwn(parents.A, "kind")].join());
lines.push([parents.A === parents.C, parents.A.prototype === parents.C.prototype, parents.A.toString() === parents.C.toString(), parents.B.self() === parents.B, Object.getPrototypeOf(parents.C).self() === Object.getPrototypeOf(parents.C), parents.B.self() === Object.getPrototypeOf(parents.C)].join());
lines.push([new A() instanceof parents.A, new A() instanceof parents.C, new C() instanceof Other, new B() instanceof Base, new D() instanceof lower].join());
// What is laid on one prototype object stays there.
parents.A.prototype.tick = function () { return "replaced"; };
lines.push([new A().tick(), new C().tick(), new Loose().tick(), new D().tick()].join());
Object.defineProperty(parents.C.prototype, "started", { set(value) { lines.push("a field is defined, no setter runs"); }, configurable: true });
lines.push(Object.keys(new C()).join("/"));
// The base of one evaluation is replaced afterwards.
Object.setPrototypeOf(parents.B, class { constructor() { this.from = "elsewhere"; } });
lines.push(attempt(() => Object.keys(new B()).join("/")), attempt(() => Object.keys(new A()).join("/")));
// Many objects, so that what is compiled for the usual case runs.
let sum = 0;
for (let i = 0; i < 3000; i++) { const a = new A(), c = new C(), d = new D(), l = new Loose(); sum += c.tick() + d.tick() + l.tick() + c.size() + a.id + (a.tick() === "replaced" ? 1 : 0); }
lines.push(String(sum), [A.count, C.count, D.count, Loose.count, parents.A.count].join());
console.log(lines.join("\n"));
