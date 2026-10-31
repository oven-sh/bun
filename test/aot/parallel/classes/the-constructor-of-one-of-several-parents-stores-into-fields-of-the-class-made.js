// `class A extends parents[n] {}`: the parent is one of several, so the base constructor that allocates does not name A, and only new.target says what it makes.
// `this.context = context` is a store into a field of A or of B, tested for those two. The base constructor's own layout has no instances, and the store used to look the name up each time.
// COUNT: arrivals <= 40100
const say = (...words) => console.log(words.join(" "));
const pick = process.argv.length > 50 ? 1 : 0;

function classesBelowOneOf() {
  class Node {
    #raw;
    count = 0;
    context;
    constructor(context, raw) {
      this.context = context;
      this.#raw = raw;
    }
    get raw() {
      return this.#raw;
    }
  }
  class Leaf {
    constructor(context, raw) {
      this.context = raw;
      this.other = context;
    }
    get raw() {
      return this.context;
    }
  }
  return [Node, Leaf][pick];
}

const context = { name: "context" };
const raw = { k: 1 };

// Only these two classes are ever new.target.
{
  class Node {
    #raw;
    count = 0;
    context;
    constructor(context, raw) {
      this.context = context;
      this.#raw = raw;
    }
    get raw() {
      return this.#raw;
    }
  }
  class Leaf {
    get raw() {
      return { k: 0 };
    }
  }
  const Root = [Node, Leaf][pick];
  const Named = Base => class extends Base {};
  class A extends Named(Root) {}
  class B extends Root {
    own = 1;
  }
  const kinds = [A, B];
  let sum = 0;
  for (let i = 0; i < 40000; i++) {
    const made = new kinds[i & 1](context, raw);
    sum += made.raw.k + (made.context === context ? 1 : 0);
  }
  say("sum", sum);
}

// new.target may be anything here, and what is made may be of no class that is written.
{
  const Root = classesBelowOneOf();
  class B extends Root {
    own = 1;
  }
  const reflected = Reflect.construct(Root, [context, raw], B);
  say(reflected instanceof B, reflected instanceof Root, reflected.own, reflected.context === context, reflected.raw === raw);
  const plain = Reflect.construct(Root, [context, raw], function Fn() {});
  say(plain instanceof Root, plain.context === context, plain.raw === raw, Object.keys(plain).join());
  const direct = new Root(context, raw);
  say(direct instanceof Root, direct.context === context, direct.raw === raw, Object.keys(direct).join());

  function Other() {}
  Other.prototype = {
    set context(value) {
      say("setter", value === context);
    },
    set other(value) {
      say("setter of other", value === context);
    },
  };
  const withSetter = Reflect.construct(Root, [context, raw], Other);
  say(Object.keys(withSetter).join(), withSetter.raw === raw);
}

// A constructor below hands out something else, and looks at the object before the store of its own.
{
  const Root = classesBelowOneOf();
  class Returns extends Root {
    constructor(context, raw) {
      const made = super(context, raw);
      return Object.assign(Object.create(null), { raw: made.raw, marked: true });
    }
  }
  class Watches extends Root {
    late = 2;
    constructor(context, raw) {
      super(context, raw);
      say(Object.keys(this).join());
    }
  }
  const replaced = new Returns(context, raw);
  say(replaced.marked, replaced.raw === raw, Object.keys(replaced).join());
  new Watches(context, raw);
}

// Only one class below, and its prototype property may be changed by a property set from outside: new.target stays that class.
{
  class Node {
    context;
    constructor(context) {
      this.context = context;
    }
  }
  class Leaf {
    constructor(context) {
      this.leaf = context;
    }
  }
  const Root = [Node, Leaf][pick];
  function Late() {
    return Reflect.construct(Root, [context], Late);
  }
  const before = Late();
  Late.prototype = {
    set context(value) {
      say("setter", value === context);
    },
  };
  const after = Late();
  say(Object.keys(before).join(), Object.keys(after).join(), Object.getPrototypeOf(after) === Late.prototype);
}
