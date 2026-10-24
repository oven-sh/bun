// A for-in loop that runs many times over objects of one shape lists the same keys each time, and sees what a prototype gets, hides or loses between two loops.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
function keysOf(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys.join();
}
function repeated(object) {
  const first = keysOf(object);
  for (let i = 0; i < 200; i++) {
    const next = keysOf(object);
    if (next !== first) return first + " then " + next + " at " + i;
  }
  return first;
}
function show(what, ...objects) {
  console.log(what + ": " + objects.map(repeated).join(" | "));
}

const a = new Point(1, 2), b = new Point(3, 4);
show("instances", a, b);
Point.prototype.tag = "t";
show("the prototype got a name", a, b);
Object.defineProperty(Point.prototype, "tag", { enumerable: false });
show("the name is hidden", a, b);
Object.defineProperty(Point.prototype, "tag", { enumerable: true });
show("the name is listed again", a, b);
delete Point.prototype.tag;
show("the name is gone", a, b);

const base = { inherited: 1 };
Object.setPrototypeOf(Point.prototype, base);
show("another object above the prototype", a, b);
base.more = 2;
show("it got a name", a, b);
a.inherited = 0;
show("an own name hides an inherited one", a, b);
Object.setPrototypeOf(Point.prototype, Object.prototype);
show("the usual chain again", a, b);

b.z = 5;
show("one instance got a name", a, b, new Point(0, 0));
delete b.x;
show("and lost one", a, b, new Point(0, 0));
b.x = 6;
show("and got it back", a, b);

function literal(flip) {
  return flip ? { p: 1, q: 2 } : { q: 2, p: 1 };
}
show("literals", literal(true), literal(false), literal(true));
function filled(order) {
  const object = {};
  for (const name of order) {
    if (name === "p") object.p = 1;
    else if (name === "q") object.q = 2;
    else object.r = 3;
  }
  return object;
}
show("filled in several orders", filled("pqr"), filled("rqp"), filled("qp"), filled("p"), filled(""), filled("pqr"));
show("frozen", Object.freeze(filled("pq")), filled("pq"), Object.seal(filled("qp")));

const heir = Object.create(literal(true));
heir.own = 1;
show("an object below a literal", heir);
Object.getPrototypeOf(heir).late = 3;
show("the literal got a name", heir);

class Indexed {
  constructor() {
    this.x = 1;
  }
}
const indexed = new Indexed();
show("class", indexed, indexed);
Indexed.prototype[0] = 1;
show("first index on the class prototype", indexed, new Indexed());
Indexed.prototype[1] = 1;
show("second index on the class prototype", indexed, new Indexed());
delete Indexed.prototype[0];
show("index deleted from the class prototype", indexed, new Indexed());

function Old() {
  this.y = 1;
}
Old.prototype.method = function () {};
const old = new Old();
show("constructor function", old, old);
Old.prototype[0] = 1;
show("first index on its prototype", old, new Old());
Old.prototype[1] = 1;
show("second index on its prototype", old, new Old());
delete Old.prototype[0];
show("index deleted from its prototype", old, new Old());

class Base {
  constructor() {
    this.z = 1;
  }
}
class Derived extends Base {
  constructor() {
    super();
    this.w = 2;
  }
}
const derived = new Derived();
show("derived class", derived, derived);
Base.prototype[7] = 1;
show("index on the base's prototype", derived, new Derived());
Base.prototype["8"] = 1;
show("second index on the base's prototype", derived, new Derived());
Object.defineProperty(Base.prototype, 7, { enumerable: false });
show("index hidden", derived, new Derived());
