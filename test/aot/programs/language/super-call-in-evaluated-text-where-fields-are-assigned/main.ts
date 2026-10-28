// @ts-nocheck
// The compiler options say that fields are assigned. Each class has private members and no field with a value, and calls super() in evaluated text or as written.
class Parent {
  made = "parent";
}
function tell(name: string, make: () => unknown) {
  try {
    console.log(name, JSON.stringify(make()));
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
tell("private method", () => {
  class Child extends Parent {
    #m() {
      return 1;
    }
    constructor() {
      eval("super()");
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private accessor", () => {
  class Child extends Parent {
    get #g() {
      return 5;
    }
    constructor() {
      eval("super()");
      this.seen = this.#g;
    }
  }
  return new Child();
});
tell("private field without a value", () => {
  class Child extends Parent {
    #f;
    constructor() {
      eval("super()");
      this.#f = 4;
      this.seen = this.#f;
    }
  }
  return new Child();
});
tell("no members", () => {
  class Child extends Parent {
    constructor() {
      eval("super()");
    }
  }
  return new Child();
});
tell("private method, super() as written", () => {
  class Child extends Parent {
    #m() {
      return 6;
    }
    constructor() {
      super();
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private method without a parent", () => {
  class Child {
    #m() {
      return 8;
    }
    constructor() {
      this.seen = this.#m();
    }
  }
  return new Child();
});
tell("private method, no constructor", () => {
  class Child extends Parent {
    #m() {
      return 9;
    }
    read() {
      return this.#m();
    }
  }
  return new Child().read();
});
