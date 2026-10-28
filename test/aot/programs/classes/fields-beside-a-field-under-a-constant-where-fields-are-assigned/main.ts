// The compiler options say that fields are assigned. A class has a field under a constant, in brackets, beside other fields: a constant that is declared first in its file or function, one that is declared later, a variable, a member of an enum, a symbol. The class above it has a setter, a getter or a read-only property under one of the names.
const text = "text",
  count = 7,
  negative = -7,
  quoted = `quoted`;
enum Numbers {
  one = 21,
  negative = -22,
}
enum Texts {
  one = "enum text",
}
const enum InlinedTexts {
  one = "inlined text",
}
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

const late = "late";
let variable = "variable";
const mark = Symbol("mark");
const holder = { name: "held" } as const;

tell(
  text,
  Above =>
    class extends Above {
      before = 0;
      [text] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  count,
  Above =>
    class extends Above {
      before = 0;
      [count] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  negative,
  Above =>
    class extends Above {
      before = 0;
      [negative] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  quoted,
  Above =>
    class extends Above {
      before = 0;
      [quoted] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  late,
  Above =>
    class extends Above {
      before = 0;
      [late] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  variable,
  Above =>
    class extends Above {
      before = 0;
      [variable] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Numbers.one,
  Above =>
    class extends Above {
      before = 0;
      [Numbers.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Numbers.negative,
  Above =>
    class extends Above {
      before = 0;
      [Numbers.negative] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Texts.one,
  Above =>
    class extends Above {
      before = 0;
      [Texts.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  InlinedTexts.one,
  Above =>
    class extends Above {
      before = 0;
      [InlinedTexts.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  mark,
  Above =>
    class extends Above {
      before = 0;
      [mark] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  holder.name,
  Above =>
    class extends Above {
      before = 0;
      [holder.name] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Symbol.toStringTag,
  Above =>
    class extends Above {
      before = 0;
      [Symbol.toStringTag] = 1;
      y = 2;
      optional?: number;
    },
);

function declareInFunction(Above: Class): Class {
  const inner = "inner";
  return class extends Above {
    before = 0;
    [inner] = 1;
    y = 2;
    optional?: number;
  };
}
tell("inner", declareInFunction);

function declareBehindStatement(Above: Class): Class {
  log.push("called");
  const inner = "behind";
  return class extends Above {
    before = 0;
    [inner] = 1;
    y = 2;
    optional?: number;
  };
}
tell("behind", declareBehindStatement);
variable = "changed";
