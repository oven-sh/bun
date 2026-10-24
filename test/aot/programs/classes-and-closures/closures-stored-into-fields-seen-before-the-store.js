// Between the allocation of an object and the store of a closure into one of its fields the object has no such property: whoever looks at the object in between sees that,
// and the order of the keys is the order of the stores.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
function describe(object) {
  const inOrder = [];
  for (const key in object) inOrder.push(key);
  return Object.keys(object).join() + "|" + inOrder.join() + "|" + JSON.stringify(object) + "|" + Object.getOwnPropertyNames(object).length;
}

class Early {
  first = () => "first of " + this.name;
  seenAtFirst = Object.keys(this).join();
  laterSeenEarly = this.later;
  hasLaterEarly = "later" in this;
  ownLaterEarly = Object.hasOwn(this, "later");
  typeEarly = typeof this.later;
  name = "early";
  later = () => "later of " + this.name;
  seenAtEnd = Object.keys(this).join();
  laterSeenLate = this.later;
}
for (let i = 0; i < 3; i++) {
  const early = new Early();
  say("early", early.seenAtFirst, early.laterSeenEarly, early.hasLaterEarly, early.ownLaterEarly, early.typeEarly, early.seenAtEnd, early.laterSeenLate === early.later, early.later(), early.first());
  say("early keys", describe(early));
}

// A call before the store throws, and the object goes on.
class CalledEarly {
  result = (() => {
    try {
      return this.run();
    } catch (error) {
      return error instanceof TypeError ? "TypeError" : "other";
    }
  })();
  run = () => "ran";
}
say("called early", new CalledEarly().result, new CalledEarly().run());

// The prototype has the name: a method, then a getter, then a setter that a definition must not run.
class WithMethod {
  before = this.act();
  act = () => "own";
  after = this.act();
  act() {
    return "inherited";
  }
}
say("method above", new WithMethod().before, new WithMethod().after, Object.keys(new WithMethod()).join());

let setterRuns = 0;
class WithAccessor {
  before = this.act;
  act = () => "own";
  after = this.act();
  get act() {
    return "from the getter";
  }
  set act(value) {
    setterRuns++;
  }
}
say("accessor above", new WithAccessor().before, new WithAccessor().after, setterRuns, Object.keys(new WithAccessor()).join());

class StoresOverAccessor {
  log = [];
  constructor() {
    this.act = () => "stored";
  }
  get act() {
    return "from the getter";
  }
  set act(value) {
    this.log.push(typeof value);
  }
}
const overAccessor = new StoresOverAccessor();
say("a store runs the setter", overAccessor.act, overAccessor.log.join(), Object.keys(overAccessor).join());

// The object escapes before the store.
const seen = [];
function look(object, at) {
  seen.push(at + ":" + Object.keys(object).join("+") + ":" + typeof object.work);
  return at;
}
class Escapes {
  a = look(this, "a");
  work = () => this.a + this.b;
  b = look(this, "b");
}
for (let i = 0; i < 2; i++) say("escapes", new Escapes().work(), seen.splice(0).join(" "));

// Key order with stores in the constructor, in another order on another path.
class Ordered {
  constructor(flip) {
    if (flip) {
      this.two = () => 2;
      this.one = () => 1;
    } else {
      this.one = () => 1;
      this.two = () => 2;
    }
    this.three = 3;
  }
}
say("order", describe(new Ordered(false)), describe(new Ordered(true)), new Ordered(true).one() + new Ordered(false).two());

// Copies.
class Source {
  n = 1;
  get = () => this.n;
  tail = "t";
}
const source = new Source();
const spread = { ...source };
const assigned = Object.assign({}, source);
const assignedOver = Object.assign(new Source(), source);
source.n = 7;
say("copies", Object.keys(spread).join(), spread.get === source.get, spread.get(), assigned.get === source.get, assignedOver.get === source.get, assignedOver.get(), assignedOver.n);
const unread = new Source();
const spreadOfUnread = { ...unread };
say("copy of an unread closure", spreadOfUnread.get === unread.get, spreadOfUnread.get(), Object.entries(new Source()).map(([key, value]) => key + ":" + typeof value).join(), Object.values(new Source()).length);
function cloneFails(value) {
  try {
    structuredClone(value);
    return "cloned";
  } catch (error) {
    return error.name;
  }
}
say("structuredClone", cloneFails(new Source()), cloneFails({ plain: () => 1 }), JSON.stringify(new Source()), JSON.stringify({ a: 1, f: () => 1, b: 2 }), JSON.stringify([new Source().get]));

// Descriptors.
const descriptor = Object.getOwnPropertyDescriptor(new Source(), "get");
say("descriptor", typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable);
const described = new Source();
say("descriptor value", Object.getOwnPropertyDescriptor(described, "get").value === described.get, Object.getOwnPropertyDescriptors(described).get.value === described.get, Reflect.ownKeys(described).join(), Reflect.get(described, "get") === described.get, Reflect.has(described, "get"));

// Destructuring and computed names.
const { get: taken, ...rest } = new Source();
const name = ["g", "e", "t"].join("");
const computed = new Source();
say("by other ways", taken(), Object.keys(rest).join(), computed[name] === computed.get, computed[name](), name in computed);

// A literal that is looked at while it is built.
function build(n) {
  const object = { n };
  const before = Object.keys(object).join();
  object.run = () => object.n + 1;
  const between = Object.keys(object).join();
  object.stop = () => object.n - 1;
  return [before, between, Object.keys(object).join(), object.run() + object.stop()].join(" ");
}
say("literal", build(1), build(2));

console.log(lines.join("\n"));
