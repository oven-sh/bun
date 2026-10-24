// The name arrives on the prototype of the base class while the derived classes do not exist yet: their class definitions are evaluated afterwards,
// one at the top level of the module behind the change, one inside a function. What is made for a class at its birth must know what happened above it before.
const log: string[] = [];
class Base {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
}
function warm(make: (id: number) => { id: number; extra?: number }) {
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    const object = make(i & 7);
    sum += object.extra ?? 1;
    if (i & 1) object.extra = 2;
    sum += object.extra ?? 1;
  }
  return sum;
}
class Sibling extends Base {
  declare extra?: number;
}
console.log("a sibling, before:", warm(id => new Sibling(id)));

Object.defineProperty(Object.getPrototypeOf(new Base(0)), ["ex", "tra"].join(""), {
  get(this: Base) {
    return this.id + 50;
  },
  set(this: Base, value: number) {
    if (log.length < 3) log.push(`set ${value} on ${this.id}`);
  },
  configurable: true,
});

class Late extends Base {
  declare extra?: number;
}
function readLate(object: Late) {
  return object.extra;
}
function writeLate(object: Late, value: number) {
  object.extra = value;
}
function define() {
  return class Inner extends Base {
    declare extra?: number;
    read() {
      return this.extra;
    }
    write(value: number) {
      this.extra = value;
    }
  };
}
const late = new Late(1);
console.log("born after the change:", readLate(late), "extra" in late, Object.keys(late).join());
writeLate(late, 5);
console.log("stored:", readLate(late), Object.keys(late).join(), log.join(", "));
const Inner = define();
const inner = new Inner(2);
console.log("born in a function:", inner.read(), Object.keys(inner).join());
inner.write(6);
console.log("stored:", inner.read(), Object.keys(inner).join(), log.join(", "));
console.log("many:", warm(id => new Late(id)), warm(id => new Inner(id)), warm(id => new Sibling(id)));
delete (Base.prototype as any).extra;
const Clean = define();
console.log("gone again:", warm(id => new Late(id)), warm(id => new Inner(id)), warm(id => new Sibling(id)), warm(id => new Clean(id)));
