// A derived constructor calls its parent from text handed to a direct eval.
const lines = [];
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  lines.push(name + ": " + (typeof answer === "string" ? answer : JSON.stringify(answer)));
};
class Parent {
  constructor(...values) {
    this.values = values;
    this.made = new.target.name;
  }
  greet() {
    return "parent of " + this.made;
  }
}

say("plain", () => {
  class Child extends Parent {
    constructor() {
      eval("super()");
    }
  }
  const child = new Child();
  return [child instanceof Child, child instanceof Parent, child.made, child.values];
});
say("arguments", () => {
  class Child extends Parent {
    constructor(a, b) {
      eval("super(a, b, a + b)");
    }
  }
  return new Child(1, 2).values;
});
say("spread", () => {
  class Child extends Parent {
    constructor(...all) {
      eval("super(...all, ...'xy')");
    }
  }
  return new Child(1, 2).values;
});
say("value of the call", () => {
  class Child extends Parent {
    constructor() {
      const result = eval("super()");
      this.same = result === this;
    }
  }
  return new Child().same;
});
say("this after the call, in the text", () => {
  class Child extends Parent {
    constructor() {
      eval("super(7); this.seen = this.values[0]");
    }
  }
  return new Child().seen;
});
say("this after the call, behind the text", () => {
  class Child extends Parent {
    constructor() {
      eval("super(8)");
      this.seen = this.values[0] + 1;
    }
  }
  return new Child().seen;
});
say("this before the call", () => {
  class Child extends Parent {
    constructor() {
      eval("this.early = 1; super()");
    }
  }
  return new Child().early;
});
say("never called", () => {
  class Child extends Parent {
    constructor() {
      eval("1");
    }
  }
  return new Child();
});
say("called twice in one text", () => {
  let count = 0;
  class Base {
    constructor() {
      count++;
    }
  }
  class Child extends Base {
    constructor() {
      try {
        eval("super(); super()");
      } catch (error) {
        this.error = error.constructor.name + " " + count;
      }
    }
  }
  return new Child().error;
});
say("called in the text and then in the constructor", () => {
  let count = 0;
  class Base {
    constructor() {
      count++;
    }
  }
  class Child extends Base {
    constructor() {
      eval("super()");
      try {
        super();
      } catch (error) {
        this.error = error.constructor.name + " " + count;
      }
    }
  }
  return new Child().error;
});
say("called in the constructor and then in the text", () => {
  let count = 0;
  class Base {
    constructor() {
      count++;
    }
  }
  class Child extends Base {
    constructor() {
      super();
      try {
        eval("super()");
      } catch (error) {
        this.error = error.constructor.name + " " + count;
      }
    }
  }
  return new Child().error;
});
say("fields", () => {
  const order = [];
  class Child extends Parent {
    first = order.push("first");
    second = this.values.length;
    constructor() {
      order.push("before");
      eval("super(1, 2); order.push('in the text ' + this.first + ' ' + this.second)");
      order.push("after");
    }
  }
  const child = new Child();
  return [order, child.first, child.second, Object.keys(child)];
});
say("private names", () => {
  class Child extends Parent {
    #hidden = 5;
    #method() {
      return this.#hidden + 1;
    }
    get #both() {
      return this.#hidden + this.#method();
    }
    static has(object) {
      return #hidden in object;
    }
    constructor() {
      eval("super(); this.read = this.#hidden + this.#method() + this.#both");
      this.after = this.#both;
    }
  }
  const child = new Child();
  return [child.read, child.after, Child.has(child), Child.has({})];
});
say("field that throws", () => {
  class Child extends Parent {
    broken = (() => {
      throw new RangeError("from a field");
    })();
    constructor() {
      eval("super()");
    }
  }
  return new Child();
});
say("computed field names", () => {
  let name = "a";
  class Child extends Parent {
    [name + 1] = 1;
    [(name = "b") + 2] = 2;
    constructor() {
      eval("super()");
    }
  }
  return Object.keys(new Child());
});
say("arrow in the text", () => {
  class Child extends Parent {
    x = 1;
    constructor() {
      eval("(() => super(3))()");
      this.y = this.x + this.values[0];
    }
  }
  return new Child().y;
});
say("arrow from the text, called behind it", () => {
  class Child extends Parent {
    x = 1;
    constructor() {
      const call = eval("() => super(4)");
      call();
      this.y = this.x + this.values[0];
    }
  }
  return new Child().y;
});
say("text in an arrow", () => {
  class Child extends Parent {
    x = 2;
    constructor() {
      const call = () => eval("super(5)");
      call();
      this.y = this.x + this.values[0];
    }
  }
  return new Child().y;
});
say("text in the text", () => {
  class Child extends Parent {
    x = 3;
    constructor() {
      eval("eval('super(6)')");
      this.y = this.x + this.values[0];
    }
  }
  return new Child().y;
});
say("super property behind the call", () => {
  class Child extends Parent {
    constructor() {
      eval("super(); this.said = super.greet()");
    }
    greet() {
      return "child";
    }
  }
  return new Child().said;
});
say("new.target", () => {
  class Child extends Parent {
    constructor() {
      eval("super()");
    }
  }
  class Grandchild extends Child {}
  const made = Reflect.construct(Child, [], Grandchild);
  return [new Grandchild().made, made.made, made instanceof Grandchild];
});
say("grandchild calls from text too", () => {
  class Child extends Parent {
    a = 1;
    constructor(...all) {
      eval("super(...all)");
    }
  }
  class Grandchild extends Child {
    b = 2;
    constructor() {
      eval("super(9)");
    }
  }
  const made = new Grandchild();
  return [made.a, made.b, made.values, made.made];
});
say("parent is a function", () => {
  function Old(value) {
    this.value = value;
  }
  class Child extends Old {
    constructor() {
      eval("super(1)");
    }
  }
  return new Child().value;
});
say("parent is built in", () => {
  class List extends Array {
    constructor() {
      eval("super(3)");
    }
  }
  class Failure extends Error {
    constructor() {
      eval("super('said')");
    }
  }
  class Table extends Map {
    constructor() {
      eval("super([[1, 2]])");
    }
  }
  return [new List().length, Array.isArray(new List()), new Failure().message, new Table().get(1)];
});
say("parent returns another object", () => {
  const other = { other: true };
  class Base {
    constructor() {
      return other;
    }
  }
  class Child extends Base {
    field = 1;
    constructor() {
      eval("super()");
      this.late = 2;
    }
  }
  const made = new Child();
  return [made === other, made instanceof Child, made];
});
say("parent is a proxy", () => {
  const seen = [];
  const Watched = new Proxy(Parent, {
    construct(target, list, newTarget) {
      seen.push(list.length, newTarget.name);
      return Reflect.construct(target, list, newTarget);
    },
  });
  class Child extends Watched {
    constructor() {
      eval("super(1, 2)");
    }
  }
  return [new Child().values, seen];
});
say("parent is null", () => {
  class Child extends null {
    constructor() {
      eval("super()");
    }
  }
  return new Child();
});
say("parent swapped before the text", () => {
  class Other {
    constructor() {
      this.other = true;
    }
  }
  class Child extends Parent {
    constructor() {
      eval("super()");
    }
  }
  Object.setPrototypeOf(Child, Other);
  return new Child();
});
say("parent swapped in the text", () => {
  class Other {
    constructor() {
      this.other = true;
    }
  }
  class Child extends Parent {
    constructor() {
      eval("Object.setPrototypeOf(Child, Other); super()");
    }
  }
  return new Child();
});
say("parent swapped by an argument", () => {
  class Other {
    constructor() {
      this.other = true;
    }
  }
  class Child extends Parent {
    constructor() {
      eval("super(Object.setPrototypeOf(Child, Other) === Child)");
    }
  }
  return new Child();
});
say("parent that is no constructor", () => {
  const order = [];
  class Child extends Parent {
    constructor() {
      eval("super(order.push('argument'))");
    }
  }
  Object.setPrototypeOf(Child, () => {});
  try {
    new Child();
  } catch (error) {
    order.push(error.constructor.name);
  }
  return order;
});
say("parent throws", () => {
  class Base {
    constructor() {
      throw new SyntaxError("from the parent");
    }
  }
  class Child extends Base {
    constructor() {
      try {
        eval("super()");
      } catch (error) {
        eval("this");
      }
    }
  }
  return new Child();
});
say("conditional", () => {
  class Child extends Parent {
    constructor(inText) {
      if (inText) eval("super('text')");
      else super("code");
    }
  }
  return [new Child(true).values, new Child(false).values];
});
say("many instances", () => {
  class Child extends Parent {
    count = 1;
    constructor(index) {
      eval("super(index)");
      this.count += this.values[0];
    }
  }
  let sum = 0;
  for (let index = 0; index < 300; index++) sum += new Child(index).count;
  return sum;
});
say("returns an object behind the call", () => {
  class Child extends Parent {
    constructor() {
      eval("super()");
      return { replaced: true };
    }
  }
  return new Child();
});
say("strict text", () => {
  class Child extends Parent {
    constructor() {
      eval("'use strict'; super(1)");
    }
  }
  return new Child().values;
});
say("class expression without a name", () => {
  const Child = class extends Parent {
    f = 1;
    constructor() {
      eval("super()");
    }
  };
  return [new Child().made, new Child().f];
});
say("inner class with a static private name, key from text", () => {
  class Child extends Parent {
    constructor() {
      class Inner {
        static #own = 1;
        [eval("super(1), 'key'")]() {
          return Inner.#own;
        }
      }
      this.inner = new Inner().key();
    }
  }
  const child = new Child();
  return [child.inner, child.values];
});
say("accessors and methods see the fields", () => {
  class Child extends Parent {
    size = 2;
    get double() {
      return this.size * 2;
    }
    constructor() {
      eval("super(); this.seen = this.double");
    }
  }
  return new Child().seen;
});
console.log(lines.join("\n"));
