// Each class has a decorated field and a parent. The constructors call super() in an if, a try, an arrow, an initializer, evaluated text, or as a statement of their own.
class Parent {
  made = "parent";
}
function tell(name, make) {
  try {
    console.log(name, JSON.stringify(make()));
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
const order = [];
function keep(value, context) {
  context.addInitializer(function () {
    order.push(context.name + " extra");
  });
  return value;
}
const note = (name, value) => (order.push(name), value);
tell("in an if", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor(x) {
      if (x) {
        super();
      } else {
        super();
      }
    }
  }
  return new Child(1);
});
tell("in an initializer", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor() {
      const self = super();
      self.seen = 1;
    }
  }
  return new Child();
});
tell("behind a statement", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor() {
      order.push("before");
      super();
      order.push("after");
    }
  }
  return new Child();
});
tell("in a try", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor() {
      try {
        super();
      } finally {
        order.push("finally");
      }
    }
  }
  return new Child();
});
tell("in an arrow", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor() {
      (() => super())();
    }
  }
  return new Child();
});
tell("in evaluated text", () => {
  class Child extends Parent {
    @keep f = 1;
    constructor() {
      eval("super()");
    }
  }
  return new Child();
});
tell("two decorated fields in front of a plain one", () => {
  class Child extends Parent {
    @keep f = note("f", 1);
    @keep g = note("g", 2);
    h = note("h", 3);
    constructor() {
      if (order) super();
    }
  }
  return new Child();
});
tell("a plain field in front of a decorated one", () => {
  class Child extends Parent {
    h = note("h", 3);
    @keep f = note("f", 1);
    constructor() {
      if (order) super();
    }
  }
  return new Child();
});
tell("a plain field last, super() as a statement", () => {
  class Child extends Parent {
    @keep f = note("f", 1);
    h = note("h", 3);
    constructor() {
      super();
      order.push("body");
    }
  }
  return new Child();
});
tell("a decorated field last, super() as a statement", () => {
  class Child extends Parent {
    h = note("h", 3);
    @keep f = note("f", 1);
    constructor() {
      super();
      order.push("body");
    }
  }
  return new Child();
});
tell("no constructor", () => {
  class Child extends Parent {
    @keep f = note("f", 1);
  }
  return new Child();
});
tell("no parent", () => {
  class Child {
    @keep f = note("f", 1);
    constructor() {
      order.push("body");
    }
  }
  return new Child();
});
tell("a decorated static field", () => {
  class Child extends Parent {
    @keep static s = note("s", 1);
    constructor() {
      if (order) super();
    }
  }
  return [new Child(), Child.s];
});
console.log(order.join());
