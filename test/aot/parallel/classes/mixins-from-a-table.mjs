// Instances of classes below mixins that a table brings: the fields that the constructors above store, in and beside slots.
// COUNTER in every build: DynamicSubclassInstances >= 5
class State { constructor() { this.pos = 0; this.line = 1; } get next() { return this.pos + 1; } }
class Base { constructor(input) { this.input = input; this.state = new State(); } init() { return "base"; } }
class Reader extends Base {
  constructor(input, size) { super(input); this.size = size; this.half = size + 0.5; }
  step() { while (this.state.pos < this.size) { this.state.pos++; if (this.input === "stop") break; } return this.state.pos; }
  sum() { return this.half + this.size + this.state.pos; }
  init() { return "reader " + super.init(); }
}
const named = Super => class Named extends Super { name = "n" + this.size; init() { return "named " + super.init(); } };
const hidden = Super => class Hidden extends Super { #own = this.size; get half() { return "hidden"; } set half(value) { this.kept = value; } own() { return this.#own; } static holds(object) { return #own in object; } };
const counted = Super => class Counted extends Super { constructor(...values) { super(...values); this.count = this.count === undefined ? 1 : 2; this.size = String(this.size); } };
const plain = Super => class Plain extends Super { };
const table = { named, hidden, counted, plain };
const classes = new Map();
function build(Super, list) {
  const key = Super.name + list.join();
  if (!classes.has(key)) classes.set(key, list.reduce((made, name) => table[name](made), Super));
  return classes.get(key);
}
function show(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  console.log(object.constructor.name, object instanceof Reader, JSON.stringify(object), keys.join(), Object.getPrototypeOf(object) === object.constructor.prototype);
}
const lists = [["plain"], ["named"], ["plain", "named"], ["hidden"], ["counted"], ["named", "counted", "hidden"]];
const all = [];
for (let turn = 0; turn < 3; turn++) {
  for (const list of lists) {
    const object = new (build(Reader, list))(turn === 1 ? "stop" : "go", turn + 2);
    all.push(object);
    console.log(object.step(), object.sum(), object.init(), object.state.next);
    show(object);
  }
}
const Hidden = build(Reader, ["hidden"]);
console.log(all.map(object => Hidden.holds(object) ? object.own() : "-").join());
all[0].late = 1; delete all[1].state; Object.freeze(all[2]); all[3].size = { valueOf: () => 4 };
for (const object of all.slice(0, 5)) { try { console.log(object.step(), object.sum()); } catch (error) { console.log(error.name); } show(object); }
// A row of constructors that is not the one of the prototypes.
const Plain = build(Reader, ["plain"]);
for (const made of [Reflect.construct(Base, ["b"], Plain), Reflect.construct(Reader, ["r", 1], Plain), Reflect.construct(Plain, ["f", 1], function () {})]) {
  console.log(made instanceof Reader, made.size, made.half, "half" in made, made.state.pos);
  try { console.log(made.sum?.()); } catch (error) { console.log(error.name); }
}
const Bound = Base.bind(null);
Bound.prototype = Reader.prototype;
const below = new (table.plain(Bound))("bound", 9);
console.log(below instanceof Reader, below.size, below.half, below.sum(), Object.keys(below).join());
Object.setPrototypeOf(Plain, Base);
const other = new Plain("other", 3);
console.log(other.size, other.half, other.sum(), other.init());
Object.setPrototypeOf(Plain.prototype, Base.prototype);
const bare = new Plain("bare", 3);
console.log(bare.size, bare.step, bare instanceof Reader, bare.init());
Reader.prototype.sum = function () { return "late"; };
Object.defineProperty(Base.prototype, "size", { get() { return "above"; }, set(value) { this.stored = value; }, configurable: true });
for (const list of lists) { const object = new (build(Reader, list))("again", 5); console.log(object.sum?.(), object.size, object.stored); show(object); }
