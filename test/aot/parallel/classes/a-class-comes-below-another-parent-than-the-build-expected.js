// `class Either extends parents[n] {}`: the classes that the build expects above a class are an expectation, and its instances have room for the fields of each.
// Which fields an instance gets goes by the constructors that run: another new.target, a parent laid later, a parent that the build did not see, parents that have parents.
class Node {
  #raw;
  #count = 0;
  shown = "node";
  constructor(raw) {
    this.#raw = raw;
  }
  bump() {
    return ++this.#count;
  }
  static has(value) {
    return #raw in value;
  }
  static rawOf(value) {
    return value.#raw;
  }
}
class Leaf {
  #raw = "leaf";
  shown = "leaf";
  both = 2;
  static has(value) {
    return #raw in value;
  }
  static rawOf(value) {
    return value.#raw;
  }
}
class Third {
  #third = "third";
  shown = "third";
  static has(value) {
    return #third in value;
  }
  static thirdOf(value) {
    return value.#third;
  }
}
const attempt = (run, value) => {
  try {
    return String(run(value));
  } catch (error) {
    return error.constructor.name;
  }
};
const tell = value =>
  console.log(
    value.constructor.name,
    Node.has(value),
    Leaf.has(value),
    Third.has(value),
    attempt(Node.rawOf, value),
    attempt(Leaf.rawOf, value),
    attempt(Third.thirdOf, value),
    Object.keys(value).join(),
    value.shown,
    value instanceof Node,
    value instanceof Leaf,
    value instanceof Third,
  );
const pick = process.argv.length > 50 ? 1 : 0;
const parents = [Node, Leaf];
class Either extends parents[pick] {
  extra = 1;
}
class Other extends parents[1 - pick] {
  extra = 2;
}
for (let i = 0; i < 3; i++) {
  tell(new Either(i));
  tell(new Other(i));
  tell(Reflect.construct(Node, [i], Other));
  tell(Reflect.construct(Leaf, [i], Either));
  tell(Reflect.construct(Third, [i], Either));
  tell(Reflect.construct(Node, [i], Third));
  tell(Reflect.construct(Either, [i], Other));
  tell(Reflect.construct(Either, [i], Object));
}

Object.setPrototypeOf(Either, Leaf);
Object.setPrototypeOf(Either.prototype, Leaf.prototype);
for (let i = 0; i < 3; i++) tell(new Either(i));
Object.setPrototypeOf(Other, Third);
Object.setPrototypeOf(Other.prototype, Third.prototype);
for (let i = 0; i < 3; i++) tell(new Other(i));
Object.setPrototypeOf(Other, Node);
for (let i = 0; i < 3; i++) tell(new Other(i));

const table = { third: Third };
class Stray extends (table[process.argv.length > 50 ? "none" : "third"] ?? parents[pick]) {
  stray = 1;
}
for (let i = 0; i < 3; i++) tell(new Stray(i));

class Upper extends Node {
  #upper = "upper";
  upper() {
    return this.#upper;
  }
}
const more = [Upper, Leaf];
class BelowUpper extends more[pick] {
  last = 1;
}
class BelowEither extends [BelowUpper, Third][pick] {
  #mine = "mine";
  mine() {
    return this.#mine;
  }
}
for (let i = 0; i < 3; i++) {
  const made = new BelowEither(i);
  tell(made);
  console.log(made.upper(), made.mine(), made.bump());
  tell(new BelowUpper(i));
}
