// `class Either extends parents[n] {}`: the parent is one of several, so an instance has a field for each private name of each parent it may have, and fills those of the parent it has.
// What a private name answers does not depend on the room: an instance lacks the names of the parents it does not have.
// The constructor of a parent stores its names into those fields as it does for its own instances. Each went to the run time or to a stub once, and lay in a second object beside the instance.
// What is left: the two names that the class made by below() declares itself, for each of 80,000 instances: a class with a parent asks the run time whether the object has the name already.
// A read that stands where the compiler expects nobody to come (`one.raw()` in the first loop, for a class whose methods it cannot name) finds the field in a stub: 80,000 such reads went to the run time once.
// COUNT: operation:operationAOTPrivateDefine <= 160100
// COUNT: operation:operationAOTPrivateGet <= 120
// COUNT: operation:operationAOTPrivateSet <= 10
// COUNT: counter:CompiledStructuresMade <= 45
const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};
const pick = process.argv.length > 50 ? 1 : 0;

class Node {
  #raw;
  #count = 0;
  #label = "node";
  shown = "shown";
  constructor(raw) {
    this.#raw = raw;
  }
  #bump() {
    return ++this.#count;
  }
  get #twice() {
    return this.#count * 2;
  }
  bump() {
    return this.#bump() + this.#twice;
  }
  raw() {
    return this.#raw;
  }
  label(next) {
    const before = this.#label;
    if (next !== undefined) this.#label = next;
    return before;
  }
  static has(value) {
    return [#raw in value, #count in value, #label in value, #bump in value, #twice in value].join();
  }
  static rawOf(value) {
    return value.#raw;
  }
  static store(value, raw) {
    value.#raw = raw;
  }
  static bumpOf(value) {
    return value.#bump();
  }
}
class Leaf {
  #raw = "leaf";
  #only = 1.5;
  raw() {
    return this.#raw;
  }
  only() {
    return this.#only;
  }
  static has(value) {
    return [#raw in value, #only in value].join();
  }
  static rawOf(value) {
    return value.#raw;
  }
}

// One class text, both parents taken.
const below = Base =>
  class extends Base {
    #raw = "own";
    mine() {
      return this.#raw;
    }
  };
const parents = [Node, Leaf];
const OverNode = below(parents[pick]);
const OverLeaf = below(parents[1 - pick]);
class Either extends parents[pick] {
  extra = 1;
}
class Other extends parents[1 - pick] {
  extra = 2;
}

let sum = 0;
const kept = [];
for (let i = 0; i < 40000; i++) {
  const made = [new OverNode(i), new OverLeaf(i), new Either(i), new Other(i), new Node(i), new Leaf(i)];
  for (const one of made) sum += typeof one.raw() === "number" ? one.raw() & 3 : 1;
  sum += made[0].bump() + made[2].bump() + made[4].bump();
  if (i % 10000 === 0) kept.push(...made);
}
say(sum);
for (const one of kept.slice(0, 6)) {
  say(
    one.constructor.name || "(none)",
    Node.has(one),
    Leaf.has(one),
    attempt(() => Node.rawOf(one)),
    attempt(() => Leaf.rawOf(one)),
    attempt(() => Node.bumpOf(one)),
    attempt(() => Node.store(one, "stored")),
    attempt(() => Node.rawOf(one)),
    attempt(() => one.mine()),
  );
  say(
    Object.keys(one).join(),
    Reflect.ownKeys(one).length,
    JSON.stringify(one),
    JSON.stringify({ ...one }),
    Object.getOwnPropertySymbols(one).length,
    Object.entries(Object.getOwnPropertyDescriptors(one)).length,
  );
}

// A private name takes any value, whatever was there before.
for (const one of [new Either(1), new OverNode(1), new Node(1)]) {
  const seen = [];
  for (const next of [2, 2.5, "text", null, undefined, { k: 1 }, 2 ** 40, -0, true, 7n]) {
    Node.store(one, next);
    seen.push(typeof one.raw() + ":" + String(Object.is(one.raw(), -0) ? "-0" : one.raw()));
  }
  say(seen.join(" "));
  say(one.label("a"), one.label(5), one.label(), typeof one.label());
}

// An object that takes no more properties takes private names, and keeps taking stores under them.
class Frozen {
  #locked = Object.freeze(this);
  #late = "late";
  late(next) {
    if (next) this.#late = next;
    return this.#late;
  }
}
class Open {
  late() {
    return "open";
  }
}
const cold = [Frozen, Open];
class Ice extends cold[pick] {}
class Water extends cold[1 - pick] {}
for (let i = 0; i < 3; i++) {
  const ice = new Ice();
  say(Object.isFrozen(ice), ice.late(), ice.late("later"), ice.late(), new Water().late(), Object.keys(ice).join());
}
const sealed = Object.freeze(new Either(3));
Node.store(sealed, "into frozen");
say(sealed.raw(), sealed.bump(), Object.isFrozen(sealed));

// A name is there from its own definition on, in the order of the class.
class Ordered {
  #first = attempt(() => this.#second);
  #second = attempt(() => this.#first);
  both() {
    return this.#first + "," + this.#second;
  }
}
class Plain {
  both() {
    return "plain";
  }
}
const order = [Ordered, Plain];
class InOrder extends order[pick] {}
class NoOrder extends order[1 - pick] {}
for (let i = 0; i < 3; i++) say(new InOrder().both(), new NoOrder().both(), new Ordered().both());

// A constructor that throws leaves an object with the names it came to.
let escaped;
class Half {
  #early = "early";
  leak = (escaped = this);
  #never = (() => {
    throw new RangeError("stop");
  })();
  static look(value) {
    return [#early in value, #never in value, attempt(() => value.#early), attempt(() => value.#never)].join();
  }
}
const halves = [Half, Plain];
class HalfBelow extends halves[pick] {}
class PlainBelow extends halves[1 - pick] {}
for (let i = 0; i < 3; i++) say(attempt(() => new HalfBelow()), Half.look(escaped), Half.look(new PlainBelow()));

// A class evaluated again has names of its own.
const makeBox = tag =>
  class Box {
    #tag = tag;
    #kind() {
      return "kind-" + tag;
    }
    static tagOf(value) {
      return value.#tag + value.#kind();
    }
    static has(value) {
      return #tag in value;
    }
  };
const boxes = [makeBox("a"), makeBox("b")];
class OverA extends boxes[pick] {}
class OverB extends boxes[1 - pick] {}
for (let i = 0; i < 3; i++) {
  const a = new OverA();
  const b = new OverB();
  say(
    boxes.map(box => [box.has(a), box.has(b), attempt(() => box.tagOf(a)), attempt(() => box.tagOf(b))].join()).join(" "),
  );
}

// A constructor may answer with an object that was made long ago. It takes the names of the class once.
class Given {
  constructor(value) {
    return value;
  }
}
class Stamp extends Given {
  #stamp = "stamp";
  static read(value) {
    return value.#stamp;
  }
}
for (const one of [new Either(1), new OverLeaf(1), new Other(1), {}, []]) {
  say(attempt(() => Stamp.read(one)), attempt(() => Stamp.read(new Stamp(one))), attempt(() => new Stamp(one)), Stamp.read(one));
}

// A class with a name of its own and no private method, below parents of which one has private methods.
class Tagged extends parents[pick] {
  #tag = "tag";
  tag() {
    return this.#tag;
  }
  static has(value) {
    return #tag in value;
  }
  static tagOf(value) {
    return value.#tag;
  }
}
class TaggedToo extends parents[1 - pick] {
  #tag = "too";
  static has(value) {
    return #tag in value;
  }
  static tagOf(value) {
    return value.#tag;
  }
}
for (const one of [new Tagged(1), new TaggedToo(1), new Either(1), new Other(1), {}]) {
  say(
    Tagged.has(one),
    TaggedToo.has(one),
    attempt(() => Tagged.tagOf(one)),
    attempt(() => TaggedToo.tagOf(one)),
    Node.has(one),
    Leaf.has(one),
    attempt(() => Node.bumpOf(one)),
  );
}
