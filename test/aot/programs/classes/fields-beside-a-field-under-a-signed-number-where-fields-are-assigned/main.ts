// The compiler options say that fields are assigned. A class has a field under a number with a sign, in brackets, beside other fields. The class above it has a setter, a getter or a read-only property under one of the names.
class Base {}
Object.defineProperty(Base.prototype, "y", {
  set(value: number) {
    console.log("the setter got", value);
  },
});
class Derived extends Base {
  [-1] = 1;
  y = 2;
}
console.log(Object.keys(new Derived()).join("+"));

let log: string[] = [];

type Class = new () => object;

function above(kind: string, name: string | symbol): Class {
  class Above {}
  if (kind === "setter") {
    Object.defineProperty(Above.prototype, name, {
      set(value: unknown) {
        log.push("set " + String(name) + " to " + String(value));
      },
    });
  } else if (kind === "getter") {
    Object.defineProperty(Above.prototype, name, { get: () => "inherited" });
  } else if (kind === "read-only") {
    Object.defineProperty(Above.prototype, name, { value: "inherited", writable: false });
  }
  return Above;
}

function describe(Made: Class): string {
  log = [];
  let made: string;
  try {
    const object = new Made();
    const keys = Reflect.ownKeys(object).map(name => {
      const property = Object.getOwnPropertyDescriptor(object, name)!;
      const flags =
        (property.writable ? "w" : "-") + (property.enumerable ? "e" : "-") + (property.configurable ? "c" : "-");
      return String(name) + "=" + String(property.value) + " " + flags;
    });
    made = keys.join(", ");
  } catch (error) {
    made = (error as Error).name;
  }
  return "[" + log.join("; ") + "] {" + made + "}";
}

function tell(key: unknown, declare: (Above: Class) => Class): void {
  console.log(String(key), "nothing above", describe(declare(above("nothing", "y"))));
  for (const kind of ["setter", "getter", "read-only"]) {
    for (const name of [typeof key === "symbol" ? key : String(key), "y", "optional"]) {
      console.log(String(key), kind, "under", String(name), describe(declare(above(kind, name))));
    }
  }
}

tell(
  -1,
  Above =>
    class extends Above {
      before = 0;
      [-1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  +1,
  Above =>
    class extends Above {
      before = 0;
      [+1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -0,
  Above =>
    class extends Above {
      before = 0;
      [-0] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1.5,
  Above =>
    class extends Above {
      before = 0;
      [-1.5] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1e21,
  Above =>
    class extends Above {
      before = 0;
      [-1e21] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1,
  Above =>
    class extends Above {
      before = 0;
      [1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  NaN,
  Above =>
    class extends Above {
      before = 0;
      [NaN] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Infinity,
  Above =>
    class extends Above {
      before = 0;
      [Infinity] = 1;
      y = 2;
      optional?: number;
    },
);

class WithoutValues extends above("setter", "y") {
  [-1]?: number;
  [+2]!: number;
  declare [-3]: number;
  y = 2;
}
console.log("without values", describe(WithoutValues));

class BesideStatic extends above("setter", "y") {
  static [-1] = 1;
  y = 2;
  optional?: number;
}
console.log("static", Object.keys(BesideStatic).join("+"), describe(BesideStatic));
