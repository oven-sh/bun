// An error message quotes the expression that failed. The text of a constructor is that of its class, so the line of the expression counts from the start of the class.
function show(Class, value) {
  try {
    new Class(value);
    console.log(Class.name, "did not throw");
  } catch (error) {
    console.log(Class.name, "|", error.message);
  }
}

class ConstructorFirst {
  constructor(o) {
    this.first = o.a.x;
    this.second = o.b.x;
  }
}
class BehindMethods {
  first(o) { return o.a.x; }
  second(o) { return o.c.x; }
  constructor(o) {
    this.value = o.b.x;
  }
}
class BehindFields {
  count = 0;
  name = "";

  constructor(o) {
    const first = o.a.x;
    const second = o.b.x;
    this.count = first + second;
  }
  method(o) { return o.c.x; }
}
class ParametersOverLines {
  method(o) { return o.a.x; }
  constructor(
    o,
    unused,
  ) {
    this.first = o.a.x;
    this.second = o.b.x;
  }
}
class OnOneLine { constructor(o) { this.value = o.b.x; } }
class Calls {
  method(o) { return o.a.run(); }
  constructor(o) {
    o.a.run();
    o.b.run();
  }
}
class Base { constructor() { this.base = true; } }
class Derived extends Base {
  method(o) { return o.a.x; }
  constructor(o) {
    super();
    this.first = o.a.x;
    this.second = o.b.x;
  }
}
const Expression = class {
  method(o) { return o.a.x; }
  constructor(o) {
    this.second = o.b.x;
  }
};
const holder = {
  Held: class {
    method(o) { return o.a.x; }
    constructor(o) {
      this.second = o.b.x;
    }
  },
};

const run = () => {};
for (const Class of [ConstructorFirst, BehindMethods, BehindFields, ParametersOverLines, OnOneLine, Derived, Expression, holder.Held]) {
  show(Class, { a: { x: 1 }, b: null, c: {} });
  show(Class, { a: { x: 1 }, c: {} });
}
show(Calls, { a: { run }, b: {} });
show(Calls, { a: { run }, b: { run: 1 } });
