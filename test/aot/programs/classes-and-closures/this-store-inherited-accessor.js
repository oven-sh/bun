// A store to `this` under a name that a base class declares as an accessor runs the accessor and adds no own property. A field declared under that name hides the accessor.
const events = [];

class Root {
  set stored(value) {
    events.push("set stored " + value);
  }
}

class Base extends Root {
  #both = 0;
  get computed() {
    return "computed";
  }
  get both() {
    return this.#both;
  }
  set both(value) {
    events.push("set both " + value);
    this.#both = value * 2;
  }
  method() {
    return "method";
  }
}

class Derived extends Base {
  constructor(value) {
    super();
    this.stored = value;
    this.both = value;
    this.method = value;
    this.own = value;
    try {
      this.computed = value;
    } catch (error) {
      events.push("computed: " + (error instanceof TypeError));
    }
  }
}

class Declared extends Base {
  stored = "declared";
}

class Leaf extends Declared {
  constructor() {
    super();
    this.stored = "stored";
  }
}

function show(object) {
  return Object.keys(object).join(",") + " | " + object.stored + " " + object.both + " " + object.computed + " " + typeof object.method;
}

for (let i = 1; i <= 3; i++) console.log(show(new Derived(i)));
console.log(show(new Declared()));
console.log(show(new Leaf()));
console.log(events.join("\n"));
