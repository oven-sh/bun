function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

class First {
  constructor(value) {
    this.from = "first";
    this.value = value;
  }
  name() {
    return "first";
  }
  static make() {
    return "made by first";
  }
}

class Second {
  constructor(value) {
    this.from = "second";
    this.doubled = value * 2;
  }
  name() {
    return "second";
  }
  static make() {
    return "made by second";
  }
}

class Child extends First {
  constructor(value) {
    super(value);
    this.child = true;
  }
  name() {
    return "child of " + super.name();
  }
  static make() {
    return "child, " + super.make();
  }
}

function build(value) {
  const made = new Child(value);
  return (
    made.from +
    " " +
    Object.keys(made).join() +
    " " +
    made.name() +
    " " +
    (made instanceof First) +
    " " +
    (made instanceof Second)
  );
}

let last = "";
for (let i = 0; i < 2000; i++) last = build(i);
console.log("2000 honest constructions:", last);
attempt("static:", () => Child.make());

function plainFunction(value) {
  this.from = "a plain function";
  this.seen = value;
}

const parents = {
  "another class": Second,
  "a plain function": plainFunction,
  "a function that returns an object": function () {
    return { from: "a returned object" };
  },
  "a bound class": First.bind(null, "bound"),
  "a proxy of a class": new Proxy(Second, {
    construct(target, list, newTarget) {
      const made = Reflect.construct(target, list, newTarget);
      made.from = "a proxy";
      return made;
    },
  }),
  Array: Array,
  Object: Object,
  "an arrow function": () => {},
  "a plain object": {},
  "Function.prototype": Function.prototype,
  null: null,
  "the first class again": First,
};

for (const [name, parent] of Object.entries(parents)) {
  attempt("the parent becomes " + name + ":", () => typeof Object.setPrototypeOf(Child, parent));
  attempt("  construction:", () => build(3));
  attempt("  static:", () => Child.make());
}

Object.setPrototypeOf(Child.prototype, Second.prototype);
attempt("the prototype object's parent becomes another class's:", () => build(4));
Object.setPrototypeOf(Child.prototype, null);
attempt("the prototype object's parent becomes null:", () => build(5));
Object.setPrototypeOf(Child.prototype, First.prototype);
attempt("and the first again:", () => build(6));
