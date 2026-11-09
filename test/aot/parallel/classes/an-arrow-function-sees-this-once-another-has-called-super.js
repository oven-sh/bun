// An arrow function of a derived constructor, and the text of a direct eval in one, read `this` where they use it:
// another arrow function of the constructor may have called super() since they started.
class Base {
  constructor() {
    this.own = 1;
  }
}

class Derived extends Base {
  constructor(name) {
    const initialize = () => {
      super();
    };
    const readers = {
      arrow: () => {
        initialize();
        return this.own;
      },
      nested: () =>
        (() => {
          initialize();
          return this.own;
        })(),
      text: () => eval("initialize(); this.own"),
      readBeforeAndAfter: () => {
        try {
          this.own;
        } catch (error) {
          console.log(name, "before super():", error.constructor.name);
        }
        initialize();
        return this.own;
      },
    };
    console.log(name, readers[name]());
  }
}

for (const name of ["arrow", "nested", "text", "readBeforeAndAfter"]) {
  console.log(new Derived(name) instanceof Derived);
}
