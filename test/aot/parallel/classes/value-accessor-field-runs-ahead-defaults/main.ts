// Prints in which order the value of an `accessor` field and the default of a parameter run, in classes with no class above them. Beside a parameter property the value runs first, as the
// values of fields do and as in what TypeScript's compiler emits.
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
  "an accessor and a parameter property",
  class {
    accessor x = tell("accessor", 1);
    constructor(public a = tell("default", 1)) {}
  },
);
make(
  "a field, an accessor and a parameter property",
  class {
    y = tell("field", 1);
    accessor x = tell("accessor", 1);
    constructor(public a = tell("default", 1)) {}
  },
);
make(
  "an accessor, a parameter property and a pattern",
  class {
    accessor x = tell("accessor", 1);
    constructor(
      readonly a = 1,
      { q = tell("default", 1) } = {},
    ) {}
  },
);
make(
  "an accessor that reads the parameter property",
  class {
    accessor x = tell("accessor sees " + (this as any).a, 1);
    constructor(public a = tell("default", 1)) {}
  },
);
/* Output:
an accessor and a parameter property: accessor < default | a
a field, an accessor and a parameter property: field < accessor < default | a,y
an accessor, a parameter property and a pattern: accessor < default | a
an accessor that reads the parameter property: accessor sees undefined < default | a
*/
