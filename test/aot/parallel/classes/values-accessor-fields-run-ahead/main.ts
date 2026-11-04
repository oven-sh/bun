// Prints in which order the values of the members and the default of a parameter run, in classes that have an `accessor` field and no class above them: every value first, in the order of the
// members, then the default.
const order: string[] = [];
function tell<T>(label: string, value: T): T {
  order.push(label);
  return value;
}
function make(name: string, Made: new () => object) {
  order.length = 0;
  new Made();
  console.log(name + ":", order.join(" < "));
}
function doubled(_: unknown, context: ClassAccessorDecoratorContext<object, number>) {
  return { init: (value: number) => tell("decorator of " + String(context.name), value * 2) };
}
make(
  "an accessor",
  class {
    accessor a = tell("a", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "an accessor under a computed key",
  class {
    // @ts-ignore
    accessor [String("k")] = tell("k", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "two accessors",
  class {
    accessor a = tell("a", 1);
    // @ts-ignore
    accessor [String("k")] = tell("k", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "two accessors, the computed key first",
  class {
    // @ts-ignore
    accessor [String("k")] = tell("k", 1);
    accessor a = tell("a", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "an accessor and a private accessor",
  class {
    accessor a = tell("a", 1);
    accessor #p = tell("#p", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "a field, an accessor and a private field",
  class {
    f = tell("f", 1);
    accessor a = tell("a", 1);
    #h = tell("#h", 1);
    constructor(_d = tell("default", 1)) {}
    hidden() {
      return this.#h;
    }
  },
);
make(
  "an accessor and a static accessor",
  class {
    static accessor s = 1;
    accessor a = tell("a", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "an accessor and a pattern",
  class {
    accessor a = tell("a", 1);
    constructor({ q: _q = tell("default", 1) } = {}) {}
  },
);
make(
  "a default that reads the accessor",
  class {
    accessor a = tell("a", 7);
    constructor(_d = tell("default sees " + this.a, 1)) {}
  },
);
make(
  "a default that stores to the accessor",
  class {
    accessor a = tell("a", 7);
    constructor(_d = (this.a = tell("default", 8))) {
      tell("body sees " + this.a, 1);
    }
  },
);
make(
  "a default that reads an accessor without a value",
  class {
    accessor a: number | undefined;
    constructor(_d = tell("default sees " + this.a, 1)) {}
  },
);
make(
  "a decorated accessor",
  class {
    @doubled accessor a = tell("a", 1);
    constructor(_d = tell("default sees " + this.a, 1)) {}
  },
);
make(
  "a decorated private accessor",
  class {
    @doubled accessor #p = tell("#p", 1);
    constructor(_d = tell("default sees " + this.#p, 1)) {}
  },
);
make(
  "a class below such a class",
  class extends class {
    accessor a = tell("a", 1);
    constructor(_d = tell("default above", 1)) {}
  } {
    accessor b = tell("b", 1);
    constructor(_d = tell("default below", 1)) {
      super();
    }
  },
);
/* Output:
an accessor: a < default
an accessor under a computed key: k < default
two accessors: a < k < default
two accessors, the computed key first: k < a < default
an accessor and a private accessor: a < #p < default
a field, an accessor and a private field: f < a < #h < default
an accessor and a static accessor: a < default
an accessor and a pattern: a < default
a default that reads the accessor: a < default sees 7
a default that stores to the accessor: a < default < body sees 8
a default that reads an accessor without a value: default sees undefined
a decorated accessor: a < decorator of a < default sees 2
a decorated private accessor: #p < decorator of #p < default sees 2
a class below such a class: default below < a < default above < b
*/
