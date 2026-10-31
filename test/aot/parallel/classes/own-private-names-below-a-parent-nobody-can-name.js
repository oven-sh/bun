// `class C extends parents[n] { #a = 1; }`: nothing says what super() answers, so the object may have the name already, and then the definition throws.
// C's layout has a field for the name: an empty slot says that the object has not got it, and the definition is a store. Each one went to the run time once: 5 calls an instance here.
// A slot that is filled, or an object of no such layout, still goes to the run time, as every case below this loop shows.
// COUNT: operation:operationAOTPrivateDefine <= 160
const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (evaluating")[0];
  }
};
const pick = process.argv.length > 50 ? 1 : 0;

class Node {
  context;
  constructor(context, raw) {
    this.context = context;
    this.raw = raw;
  }
}
class Other {
  constructor(context, raw) {
    this.raw = { k: 0 };
  }
}
{
  const Root = [Node, Other][pick];
  class C extends Root {
    #a = 1;
    #b;
    constructor(context, raw) {
      super(context, raw);
      this.#b = raw;
    }
    get a() {
      return this.#a;
    }
    get b() {
      return this.#b;
    }
  }
  class D extends Root {
    #d = 2;
    #method() {
      return this.#d;
    }
    get a() {
      return this.#method();
    }
    get b() {
      return "d";
    }
  }
  const kinds = [C, D];
  const raw = { k: 1 };
  let sum = 0;
  let last;
  for (let i = 0; i < 40000; i++) {
    last = new kinds[i & 1](raw, raw);
    sum += last.a;
  }
  say("sum", sum, last.b, Object.keys(last).join());
}

// A constructor above hands the same object to the initializer twice.
class Returns {
  constructor(object) {
    return object;
  }
}
const parents = [Returns, class Unused {}];
const Parent = parents[pick];
class Stamped extends Parent {
  #stamp = "stamped";
  #later;
  static stampOf(object) {
    return object.#stamp;
  }
  static has(object) {
    return #stamp in object;
  }
}
class WithMethod extends Parent {
  #hidden() {
    return "hidden";
  }
  static call(object) {
    return object.#hidden();
  }
}
class WithAccessor extends Parent {
  get #value() {
    return "value";
  }
  static read(object) {
    return object.#value;
  }
}

function twice(Class, object) {
  say(Class.name, attempt(() => new Class(object) === object), attempt(() => new Class(object) === object));
}
for (const make of [
  () => ({}),
  () => ({ x: 1 }),
  () => [],
  () => function () {},
  () => new Node(1, 2),
  () => Object.freeze({ frozen: true }),
  () => Object.seal({ sealed: true }),
  () => Object.preventExtensions({ closed: true }),
  () => new Proxy({}, {}),
]) {
  for (const Class of [Stamped, WithMethod, WithAccessor]) twice(Class, make());
}
const stamped = {};
new Stamped(stamped);
say(Stamped.stampOf(stamped), Stamped.has(stamped), Stamped.has({}), JSON.stringify(stamped), Object.getOwnPropertyNames(stamped).length);
const called = {};
new WithMethod(called);
say(WithMethod.call(called), attempt(() => WithMethod.call({})));
const read = {};
new WithAccessor(read);
say(WithAccessor.read(read), attempt(() => WithAccessor.read({})));

// An instance of a class below takes the names of each class it passes through, once.
class Below extends Stamped {
  #own = "below";
  static ownOf(object) {
    return object.#own;
  }
}
const below = new Below({});
say(Below.ownOf(below), Stamped.stampOf(below));
say(attempt(() => new Below(below)), attempt(() => new Stamped(below)));
class Sibling extends Stamped {
  #own = "sibling";
  static ownOf(object) {
    return object.#own;
  }
}
const both = {};
new Below(both);
say(attempt(() => new Sibling(both)), attempt(() => Below.ownOf(both)), attempt(() => Sibling.ownOf(both)));

// An object of one layout gets the names of a class that is not above it, in no field of its own, and those of its own in the fields.
class Plain {
  #mine = "mine";
  static mineOf(object) {
    return object.#mine;
  }
}
const plain = new Plain();
new Stamped(plain);
say(Stamped.stampOf(plain), Plain.mineOf(plain), attempt(() => new Stamped(plain)));

// A value of another type than the field has held: the name lies outside the slot, and a second definition still finds it.
class Changes extends Parent {
  #held = 1;
  static set(object, value) {
    object.#held = value;
  }
  static get(object) {
    return object.#held;
  }
}
const instancesOfChanges = [];
for (let i = 0; i < 3; i++) instancesOfChanges.push(new Changes({}));
const changing = new Changes(instancesOfChanges[0] === 0 ? 1 : {});
Changes.set(changing, 2.5);
say(Changes.get(changing), attempt(() => new Changes(changing)));
Changes.set(changing, "text");
say(Changes.get(changing), attempt(() => new Changes(changing)), Changes.get(changing));
Changes.set(changing, { an: "object" });
say(JSON.stringify(Changes.get(changing)), attempt(() => new Changes(changing)));
Changes.set(changing, undefined);
say(Changes.get(changing), attempt(() => new Changes(changing)));

// What is defined may be nothing, and is defined all the same. The initializer may throw half way, and the object keeps what it has.
class HoldsUndefined extends Parent {
  #nothing = undefined;
  #zero = 0;
  static has(object) {
    return [#nothing in object, #zero in object].join();
  }
}
const holding = {};
new HoldsUndefined(holding);
say(HoldsUndefined.has(holding), attempt(() => new HoldsUndefined(holding)));
let fails = true;
class HalfWay extends Parent {
  #first = "first";
  #second = (() => {
    if (fails) throw new RangeError("half way");
    return "second";
  })();
  #third = "third";
  static has(object) {
    return [#first in object, #second in object, #third in object].join();
  }
}
const half = {};
say(attempt(() => new HalfWay(half)), HalfWay.has(half));
fails = false;
say(attempt(() => new HalfWay(half)), HalfWay.has(half));

// Each evaluation of a class has names of its own.
function makeClass(Base) {
  return class extends Base {
    #own = "own";
    static has(object) {
      return #own in object;
    }
    static read(object) {
      return object.#own;
    }
  };
}
const First = makeClass(Parent);
const Second = makeClass(Parent);
const shared = {};
new First(shared);
say(First.has(shared), Second.has(shared), attempt(() => Second.read(shared)));
new Second(shared);
say(First.has(shared), Second.has(shared), Second.read(shared), attempt(() => new First(shared)), attempt(() => new Second(shared)));
const madeByFirst = new First(new Node(1, 2));
say(First.read(madeByFirst), Second.has(madeByFirst));
for (let i = 0; i < 1000; i++) new (i & 1 ? First : Second)({});
say(attempt(() => new First(madeByFirst)), First.read(madeByFirst));

// new.target is another class, and a prototype that is changed leaves the names alone.
class Reflected extends Parent {
  #name = "reflected";
  static read(object) {
    return object.#name;
  }
}
const viaReflect = Reflect.construct(Reflected, [{}], Node);
say(Reflected.read(viaReflect), viaReflect instanceof Node, viaReflect instanceof Reflected);
const swapped = new Reflected({});
Object.setPrototypeOf(swapped, null);
say(Reflected.read(swapped), attempt(() => new Reflected(swapped)));

// Nothing makes an instance of these classes by themselves: new.target is always another class, so no object has their layout.
class BelowArray extends Array {}
class BelowMap extends Map {}
class BelowError extends Error {}
function Ordinary() {}
function describe(Class, object, target) {
  say(Class.name, target.name, Class.isMarked(object), attempt(() => Class.markOf(object)), object instanceof target, object instanceof Class, Array.isArray(object));
}
class OverFunction extends function (a) {} {
  #mark = 2;
  static isMarked(object) {
    return #mark in object;
  }
  static markOf(object) {
    return object.#mark;
  }
}
describe(OverFunction, Reflect.construct(OverFunction, [1], BelowArray), BelowArray);
class OverOneOfSeveral extends [Node, Other][pick] {
  #mark = "several";
  #method() {
    return this.#mark;
  }
  static isMarked(object) {
    return #method in object;
  }
  static markOf(object) {
    return object.#method();
  }
}
for (const target of [BelowArray, BelowMap, BelowError, Ordinary, Plain]) describe(OverOneOfSeveral, Reflect.construct(OverOneOfSeveral, [1, 2], target), target);
class WithoutParent {
  #mark = "no parent";
  static isMarked(object) {
    return #mark in object;
  }
  static markOf(object) {
    return object.#mark;
  }
}
for (const target of [BelowArray, BelowError, Ordinary]) describe(WithoutParent, Reflect.construct(WithoutParent, [], target), target);
class AlsoReturns {
  constructor(object) {
    return object;
  }
}
class OverReturned extends [AlsoReturns, Other][pick] {
  #mark = "returned";
  static isMarked(object) {
    return #mark in object;
  }
  static markOf(object) {
    return object.#mark;
  }
}
const givenTwice = [];
describe(OverReturned, Reflect.construct(OverReturned, [givenTwice], BelowMap), Array);
say(attempt(() => Reflect.construct(OverReturned, [givenTwice], BelowMap)));
for (let i = 0; i < 20; i++) Reflect.construct(OverFunction, [i], i & 1 ? BelowArray : BelowError);

// Only the classes below are made, and they keep the names of the class between in fields.
class Between extends [Node, Other][pick] {
  #between = 3;
  get between() {
    return this.#between;
  }
}
class Lowest extends Between {
  #lowest = 4;
  get lowest() {
    return this.#lowest;
  }
}
class AlsoLowest extends Between {}
{
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const made = i & 1 ? new Lowest(i, i) : new AlsoLowest(i, i);
    sum += made.between + (made.lowest ?? 0);
  }
  say("below", sum);
}
