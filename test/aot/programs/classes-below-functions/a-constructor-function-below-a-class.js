// The mirror: the prototype object of a function is hung below that of a class, whose constructor never runs for its objects.
class Base {
  size = 1;
  constructor() { this.made = "by the class"; }
  describe() { return this.made + " " + this.size + " " + this.own; }
  static create() { return new this(); }
}
function Below() { this.own = "own"; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
Object.setPrototypeOf(Below, Base);
function Wrapped() { const self = Reflect.construct(Base, [], new.target); self.own = "wrapped"; return self; }
Wrapped.prototype = Object.create(Base.prototype, { constructor: { value: Wrapped } });
class Leaf extends Below { constructor() { super(); this.leaf = true; } }
function all(list) { return list.map(each => each.describe() + " | " + Object.keys(each).join()).join("\n"); }
const list = [];
for (let i = 0; i < 50; i++) list.push(new Base(), new Below(), new Wrapped(), new Leaf());
console.log(all(list.slice(0, 4)));
console.log(list.every(each => each instanceof Base), Below.create() instanceof Below, new Leaf() instanceof Below, new Wrapped() instanceof Wrapped);
try { Base.call(new Below()); } catch (error) { console.log(error.constructor.name); }
