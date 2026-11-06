// `super()` in the text of a direct eval throws the TypeError that docs/compiler/compatibility.mdx names. What else the text does in a derived constructor works.
function run(label, body) {
  let result;
  try {
    result = JSON.stringify(body());
  } catch (error) {
    result = "throws " + error.constructor.name + ": " + error.message;
  }
  console.log(label + ":", result);
}
const order = [];
class A {
  constructor(value) {
    this.a = value ?? 1;
  }
  hi() {
    return "hi";
  }
}

run("plain", () => {
  class B extends A {
    constructor() {
      eval("super()");
    }
  }
  return new B().a;
});
run("with an argument", () => {
  class B extends A {
    constructor(value) {
      eval("super((order.push('argument'), value))");
    }
  }
  return new B(7).a;
});
console.log("arguments ran first:", order.join());
run("an arrow in the text", () => {
  class B extends A {
    constructor() {
      eval("(() => super())()");
    }
  }
  return new B().a;
});
run("the eval in an arrow", () => {
  class B extends A {
    constructor() {
      (() => eval("super()"))();
    }
  }
  return new B().a;
});
run("a class with fields", () => {
  class B extends A {
    field = 5;
    constructor() {
      eval("super()");
    }
  }
  return Object.keys(new B());
});
run("behind a call outside of the text", () => {
  class B extends A {
    constructor() {
      super();
      eval("super()");
    }
  }
  return new B().a;
});
run("a built-in parent", () => {
  class B extends Array {
    constructor() {
      eval("super(3)");
    }
  }
  return new B().length;
});
run("a function as the parent", () => {
  function F() {
    this.f = 1;
  }
  class B extends F {
    constructor() {
      eval("super()");
    }
  }
  return new B().f;
});
run("caught in the text", () => {
  class B extends A {
    constructor() {
      const caught = eval("try { super(); } catch (error) { error.constructor.name }");
      super();
      this.caught = caught;
    }
  }
  return new B().caught;
});
run("on one of two paths", () => {
  class B extends A {
    constructor(inText) {
      if (inText) eval("super()");
      else super();
    }
  }
  return [new B(false).a, new B(true).a];
});

run("this behind the call", () => {
  class B extends A {
    constructor() {
      super();
      this.same = eval("this") === this;
    }
  }
  return new B().same;
});
run("this before the call", () => {
  class B extends A {
    constructor() {
      eval("this");
      super();
    }
  }
  return new B().a;
});
run("a member of the parent", () => {
  class B extends A {
    constructor() {
      super();
      this.said = eval("super.hi()");
    }
  }
  return new B().said;
});
run("new.target", () => {
  class B extends A {
    constructor() {
      super();
      this.target = eval("new.target") === B;
    }
  }
  return new B().target;
});
run("text without the call", () => {
  class B extends A {
    constructor() {
      eval("1");
      super();
    }
  }
  return new B().a;
});
run("in a method", () => {
  class B extends A {
    method() {
      eval("super()");
    }
  }
  return new B().method();
});
