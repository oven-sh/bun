// With `useDefineForClassFields: false`. Prints in which order the values of `accessor` fields and the default of a parameter run, in classes with no class above them and no other field: every
// value first, in the order of the members, then the default.
const order: string[] = [];
function tell<T>(label: string, value: T): T {
  order.push(label);
  return value;
}
function make(name: string, Made: new () => object) {
  order.length = 0;
  const made = new Made();
  console.log(name + ":", order.join(" < "), "|", Object.keys(made).join(","));
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
  "an accessor and a private accessor",
  class {
    accessor a = tell("a", 1);
    accessor #p = tell("#p", 1);
    constructor(_d = tell("default", 1)) {}
  },
);
make(
  "an accessor and a parameter property",
  class {
    accessor a = tell("a", 1);
    constructor(public d = tell("default", 1)) {}
  },
);
make(
  "a default that reads the accessor",
  class {
    accessor a = tell("a", 7);
    constructor(_d = tell("default sees " + this.a, 1)) {}
  },
);
