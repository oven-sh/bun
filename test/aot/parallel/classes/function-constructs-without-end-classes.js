// A function that runs itself again without end makes, at every level, a class with a member under an index. Every form ends in the error that plain Bun throws.
const forms = {
  "a setter under a computed index, beside a class below the function"() {
    function recurse() {
      class Other {
        set [3](value) {}
      }
      class Derived extends recurse {}
      new Derived();
    }
    recurse();
  },
  "a setter under a written index, in the class below the function"() {
    function Recurse() {
      class Derived extends Recurse {
        set 42(value) {}
      }
      new Derived();
    }
    new Recurse();
  },
  "a getter under an index"() {
    function recurse() {
      class Other {
        get [0]() {
          return 1;
        }
      }
      class Derived extends recurse {}
      new Derived();
    }
    recurse();
  },
  "a getter and a setter under one index"() {
    function recurse() {
      class Other {
        get 7() {
          return 1;
        }
        set 7(value) {}
      }
      return recurse(new Other()) + 1;
    }
    recurse();
  },
  "a method under an index"() {
    function recurse() {
      class Other {
        [5]() {}
      }
      class Derived extends recurse {}
      new Derived();
    }
    recurse();
  },
  "a static setter under an index of a class that has a class below it"() {
    function recurse() {
      class Other {
        static set [3](value) {}
      }
      class Below extends Other {}
      class Derived extends recurse {}
      new Derived();
    }
    recurse();
  },
  "a static getter under an index"() {
    function recurse() {
      class Other {
        static get 3() {
          return 1;
        }
      }
      return recurse(Other) + 1;
    }
    recurse();
  },
  "a constructor that calls super itself"() {
    function recurse() {
      class Derived extends recurse {
        constructor() {
          super();
        }
        set [1](value) {}
      }
      new Derived();
    }
    recurse();
  },
  "Reflect.construct with the class as new.target"() {
    function recurse() {
      class Target {
        set [1](value) {}
      }
      Reflect.construct(recurse, [], Target);
    }
    recurse();
  },
  "a class below a proxy of the function"() {
    function recurse() {
      class Other {
        set [3](value) {}
      }
      class Derived extends (new Proxy(recurse, {})) {}
      new Derived();
    }
    recurse();
  },
  "a class below a bound function that was given a prototype property"() {
    function recurse() {
      class Other {
        set [3](value) {}
      }
      const bound = recurse.bind(null);
      bound.prototype = {};
      class Derived extends bound {}
      new Derived();
    }
    recurse();
  },
  "a class below a bound function"() {
    function recurse() {
      class Other {
        set [3](value) {}
      }
      class Derived extends recurse.bind(null) {}
      new Derived();
    }
    recurse();
  },
  "a class below an arrow function"() {
    const recurse = () => {
      class Other {
        set [3](value) {}
      }
      class Derived extends recurse {}
      new Derived();
    };
    recurse();
  },
  "an index that cannot be written, defined on the prototype object"() {
    function recurse() {
      class Other {}
      Object.defineProperty(Other.prototype, 2, { value: 1, writable: false });
      class Derived extends recurse {}
      new Derived();
    }
    recurse();
  },
  "a literal with a setter under an index, put above a new object"() {
    function recurse() {
      const below = Object.create({ set [3](value) {} });
      return recurse(below) + 1;
    }
    recurse();
  },
};

for (const [name, run] of Object.entries(forms)) {
  let outcome = "returned";
  try {
    run();
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log(`${name}: ${outcome}`);
}
