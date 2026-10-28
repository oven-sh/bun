// An arrow in a field initializer evaluates text and reads `this`, and the derived constructor calls its parent from evaluated text. `this` is whatever the parent returned.
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  console.log(name + ": " + JSON.stringify(answer));
};
say("the parent returns nothing", () => {
  class Parent {}
  class Heir extends Parent {
    first = 5;
    field = (() => [eval("1"), this.first, this instanceof Heir])();
    constructor() {
      (() => eval("super()"))();
    }
  }
  return new Heir().field;
});
say("the parent returns an array", () => {
  class Parent {
    constructor() {
      return [1, 2, 3];
    }
  }
  class Heir extends Parent {
    first = 5;
    second = "two";
    field = (() => [eval("1"), this.first, this.second, this.length, Array.isArray(this)])();
    constructor() {
      (() => eval("super()"))();
    }
  }
  return new Heir().field;
});
say("the parent returns a function", () => {
  class Parent {
    constructor() {
      return function named() {};
    }
  }
  class Heir extends Parent {
    first = 5;
    second = "two";
    field = (() => [eval("1"), this.first, this.second, this.name, typeof this])();
    constructor() {
      (() => eval("super()"))();
    }
  }
  return new Heir().field;
});
say("another parent is set later", () => {
  class Parent {}
  class Heir extends Parent {
    first = 5;
    second = "two";
    read = () => [eval("1"), this.first, this.second, this.other];
    constructor() {
      (() => eval("super()"))();
    }
  }
  const before = new Heir().read();
  Object.setPrototypeOf(Heir, function () {
    return { other: "other", zero: 0 };
  });
  return [before, new Heir().read()];
});
say("the arrow stores", () => {
  class Parent {
    constructor() {
      return { a: 1, b: 2, c: 3 };
    }
  }
  class Heir extends Parent {
    first = 5;
    second = "two";
    write = value => {
      eval("1");
      this.first = value;
      this.second = value;
      return this;
    };
    constructor() {
      (() => eval("super()"))();
    }
  }
  return new Heir().write(9);
});
