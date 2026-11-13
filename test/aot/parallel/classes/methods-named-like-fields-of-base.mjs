// The objects of a class have fields under names that are methods of the classes below it. An instance of a class below has that class's own layout, though it lists fewer fields.
const notes = [];
const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.join() + "]" : typeof value + " " + String(value));
const note = value => void notes.push(show(value));
const key = name => name;

class Base {
  n = 0;
  [key("m")] = -7;
  [key("p")] = 2;
  constructor(given) {
    this.n = given;
  }
}
class Heir extends Base {
  m(by) {
    return this.n + by;
  }
  p(by) {
    return this.n - by;
  }
  w = [1, 2];
}
function pairs() {
  const base = new Base(5);
  const heir = new Heir(1);
  for (let k = 0; k < 4; k++) {
    heir.m += k;
    note(heir.m);
    note(heir.p++);
    note(heir.w);
    note(Object.keys(heir).join());
    base.m += k;
    note(base.m);
    note(base.p++);
    note(Object.keys(base).join());
  }
}

class Shared {
  n = 1;
  constructor(given) {
    this[key("a")] = given;
    this[key("b")] = "b" + given;
    this[key("c")] = given + 0.5;
  }
}
class Counted extends Shared {
  count = 0;
  a() {
    return this.count;
  }
  b() {
    return super.n;
  }
  c() {
    return super.c();
  }
  step() {
    return (this.count += this.n);
  }
}
class Lower extends Counted {
  last = "last";
}
function make(given, depth) {
  return depth ? make(given, depth - 1) : given & 1 ? new Counted(given) : new Lower(given);
}
function lists() {
  const list = [new Shared(1), make(2, 1), make(3, 2)];
  for (let j = 0; j < 2; j++) {
    for (let k = 0; k < list.length; k++) {
      const one = list[k];
      one.a = k;
      one.b = "k" + j;
      one.c += 1;
      note(one.a + one.b + one.c);
      if (one instanceof Counted) note(one.step() + one.count);
      note(one.last);
    }
  }
  for (const one of list) note(Object.entries(one).join());
}

for (let round = 0; round < 2; round++) {
  pairs();
  lists();
}
console.log(notes.join(" "));
