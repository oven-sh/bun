function makeBelow() {
  class Base {
    [Symbol.asyncIterator]() {}
    base() {}
  }
  class Derived extends Base {}
  return new Derived();
}

function makeWithField() {
  class Base {
    [Symbol.asyncIterator]() {}
    base() {}
  }
  class Derived extends Base {
    constructor() {
      super();
      this.field = 1;
    }
  }
  return new Derived();
}

// The quick walk of the printer counts a private field, and goes on quickly above it.
function makeAbovePrivateField() {
  class Base {
    base() {}
  }
  class Derived extends Base {
    [Symbol.asyncIterator]() {}
    derived() {}
    isMarked() { return #mark in this; }
    #mark = 1;
  }
  return Object.create(new Derived());
}

function makeWithPrivateMethod() {
  class Base {
    [Symbol.asyncIterator]() {}
    base() {}
  }
  class Derived extends Base {
    #hidden() {}
    static isDerived(value) { return #hidden in value; }
  }
  return Object.create(new Derived());
}

for (const make of [makeBelow, makeWithField, makeAbovePrivateField, makeWithPrivateMethod]) {
  for (let round = 0; round < 3; round++) console.log(Bun.inspect(make()));
}
