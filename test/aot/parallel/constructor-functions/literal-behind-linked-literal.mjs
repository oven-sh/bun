// A literal names its parent by __proto__, and a plain literal takes its place: the objects made before keep the parent.
function Base(v) { this.v = v; }
Base.prototype = { ask() { return this.v * 4; } };
function Child(v) { this.v = v; }
Child.prototype = { __proto__: Base.prototype, constructor: Child };
const one = new Child(1);
function call(list) { const out = []; for (const each of list) out.push(each.ask()); return out.join(); }
console.log(call([one, new Child(2)]));
Child.prototype = { ask: () => 77 };
console.log(call([one, new Child(2)]));
