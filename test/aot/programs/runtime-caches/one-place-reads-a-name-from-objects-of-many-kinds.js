// One place in the text reads one name from objects of many kinds in turn: what is remembered at the place fits one of them at most,
// so the others are answered by what is remembered for their kind. Then the kinds change under the place.
function read(object) {
  return object.mark;
}
function readTwice(object) {
  return [object.mark, object.other];
}

class Field {
  constructor(mark) {
    this.mark = mark;
  }
}
class Late {
  constructor() {
    this.first = 1;
  }
}
class Inherits {}
Inherits.prototype.mark = "from the prototype";
class Computes {
  get mark() {
    return "computed " + this.seed;
  }
  constructor(seed) {
    this.seed = seed;
  }
}
class Lacks {
  constructor() {
    this.nothing = 0;
  }
}
function Bag() {}
Bag.prototype = Object.create(null);

function make(kind, i) {
  switch (kind) {
    case 0:
      return new Field("field " + i);
    case 1: {
      const late = new Late();
      late["ma" + "rk"] = "extra " + i;
      return late;
    }
    case 2:
      return new Inherits();
    case 3:
      return new Computes(i);
    case 4:
      return new Lacks();
    case 5:
      return JSON.parse('{"mark":"parsed ' + i + '"}');
    case 6: {
      const many = JSON.parse("{}");
      for (let n = 0; n < 12; n++) many["k" + n] = n;
      many.mark = "out of line " + i;
      return many;
    }
    case 7: {
      const bag = new Bag();
      bag["other"] = i;
      bag["mark"] = "bag " + i;
      return bag;
    }
    case 8:
      return Object.create({ mark: "above an ordinary object" });
    case 9:
      return function () {};
    case 10:
      return [i];
    case 11:
      return "text";
    default:
      return i;
  }
}

const kinds = 13;
function round(label) {
  const seen = [];
  for (let i = 0; i < kinds * 40; i++) {
    const value = read(make(i % kinds, i));
    if (i >= kinds * 39) seen.push(String(value));
  }
  console.log(label, seen.join(" | "));
}
round("as they are made:");

Object.defineProperty(Lacks.prototype, "mark", { configurable: true, get() { return "now computed above"; } });
round("a getter above the one that lacked it:");
delete Lacks.prototype.mark;
Inherits.prototype.mark = "stored again above";
round("the getter gone, another value above:");
delete Inherits.prototype.mark;
const top = { mark: "at the top" };
Object.setPrototypeOf(Inherits.prototype, top);
Object.setPrototypeOf(Lacks.prototype, top);
Object.setPrototypeOf(Bag.prototype, top);
round("another object at the top of three chains:");
delete top.mark;
round("and nothing in it:");
top.mark = "there again";
Object.setPrototypeOf(Lacks.prototype, Object.prototype);
Object.setPrototypeOf(Computes.prototype, { other: "far above" });
round("as at first, but for what was deleted:");

const pairs = [];
for (let i = 0; i < kinds * 30; i++) {
  const object = make(i % kinds, i);
  if (i % kinds === 0 && i % 2) delete object.mark;
  if (i % kinds === 1 && i % 2) Object.defineProperty(object, "mark", { get() { return "own getter"; } });
  if (i % kinds === 5 && i % 2) Object.freeze(object);
  if (i % kinds === 7 && i % 2) delete object.other;
  const pair = readTwice(object);
  if (i >= kinds * 28) pairs.push(pair.map(String).join("+"));
}
console.log(pairs.join(" | "));
