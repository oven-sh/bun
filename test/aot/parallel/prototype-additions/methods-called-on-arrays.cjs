// The global object is let go, so evaluated text may come by every prototype. A method is called on what is an instance, an array or a primitive: no array has it, and the call throws.
const log = console.log.bind(console);
globalThis.self = globalThis;
globalThis.everything = { prototype: Object.getPrototypeOf([]) };

function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype.plus = function (other) {
  return new Vector(this.x + other.x, this.y + other.y);
};
Vector.prototype.toString = function () {
  return "[" + this.x + ", " + this.y + "]";
};

function Table() {
  this.root = null;
}
Table.prototype.put = function (key, value) {
  for (let at = this.root; at; at = at.next) {
    if (at.key == key) {
      const old = at.value;
      at.value = value;
      return old;
    }
  }
  this.root = { key, value, next: this.root };
  return null;
};
Table.prototype.get = function (key) {
  for (let at = this.root; at; at = at.next) if (at.key == key) return at.value;
  return null;
};

const positions = new Table(), lists = new Table(), seen = new Table();
let sum = 0, thrown = 0;
const list = [];
for (let i = 0; i < 200; i++) {
  const old = positions.put(i % 7, new Vector(i, i / 2));
  seen.put(i % 5, true);
  if (!lists.get(i % 3)) lists.put(i % 3, []);
  lists.get(i % 3).push(new Vector(1, i));
  const mixed = i % 50 === 49 ? lists.get(0) : i % 50 === 24 ? seen.get(0) : old;
  try {
    const moved = mixed.plus(new Vector(1, 2));
    sum += moved.x + moved.y;
    list.push(moved);
  } catch (e) {
    thrown++;
    sum += e instanceof TypeError ? 1000 : 100000;
  }
}
log(sum, thrown, list.length, "last " + [list[0], list[list.length - 1]], Object.keys(list[3]).join());
log(Object.hasOwn(Array.prototype, "plus"), [].plus === undefined, (5).plus, "x".plus);
