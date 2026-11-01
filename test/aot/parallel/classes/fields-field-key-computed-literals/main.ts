// @ts-nocheck
// The compiler options say that fields are assigned. A class has a field under a key, in brackets, that is computed from literals and constants, beside other fields. The class above it has a setter, a getter or a read-only property under one of the names.
const text = "text",
  count = 7;
enum Numbers {
  one = 21,
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

function name(): string {
  log.push("name()");
  return "called";
}

// prettier-ignore
tell(("a"), Above => class extends Above { before = 0; [("a")] = 1; y = 2; optional?: number; });
// prettier-ignore
tell((1), Above => class extends Above { before = 0; [(1)] = 1; y = 2; optional?: number; });
// prettier-ignore
tell((-1), Above => class extends Above { before = 0; [(-1)] = 1; y = 2; optional?: number; });
// prettier-ignore
tell(-(1), Above => class extends Above { before = 0; [-(1)] = 1; y = 2; optional?: number; });
tell(
  -(-1),
  Above =>
    class extends Above {
      before = 0;
      [-(-1)] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a" as string,
  Above =>
    class extends Above {
      before = 0;
      ["a" as string] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a" as const,
  Above =>
    class extends Above {
      before = 0;
      ["a" as const] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a"!,
  Above =>
    class extends Above {
      before = 0;
      ["a"!] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a" satisfies string,
  Above =>
    class extends Above {
      before = 0;
      ["a" satisfies string] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  <string>"a",
  Above =>
    class extends Above {
      before = 0;
      [<string>"a"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1 as number,
  Above =>
    class extends Above {
      before = 0;
      [-1 as number] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a" + "b",
  Above =>
    class extends Above {
      before = 0;
      ["a" + "b"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "a" + 1,
  Above =>
    class extends Above {
      before = 0;
      ["a" + 1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 + 2,
  Above =>
    class extends Above {
      before = 0;
      [1 + 2] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 - 2,
  Above =>
    class extends Above {
      before = 0;
      [1 - 2] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  2 * 3,
  Above =>
    class extends Above {
      before = 0;
      [2 * 3] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 / 2,
  Above =>
    class extends Above {
      before = 0;
      [1 / 2] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  5 % 3,
  Above =>
    class extends Above {
      before = 0;
      [5 % 3] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  2 ** 3,
  Above =>
    class extends Above {
      before = 0;
      [2 ** 3] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 << 2,
  Above =>
    class extends Above {
      before = 0;
      [1 << 2] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  ~1,
  Above =>
    class extends Above {
      before = 0;
      [~1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  `a${"b"}`,
  Above =>
    class extends Above {
      before = 0;
      [`a${"b"}`] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  `a${1}`,
  Above =>
    class extends Above {
      before = 0;
      [`a${1}`] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  `a${text}`,
  Above =>
    class extends Above {
      before = 0;
      [`a${text}`] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  typeof 1,
  Above =>
    class extends Above {
      before = 0;
      [typeof 1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 ? "a" : "b",
  Above =>
    class extends Above {
      before = 0;
      [1 ? "a" : "b"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  0 || "a",
  Above =>
    class extends Above {
      before = 0;
      [0 || "a"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1 && "a",
  Above =>
    class extends Above {
      before = 0;
      [1 && "a"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  null ?? "a",
  Above =>
    class extends Above {
      before = 0;
      [null ?? "a"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  (0, "a"),
  Above =>
    class extends Above {
      before = 0;
      [(0, "a")] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  +"1",
  Above =>
    class extends Above {
      before = 0;
      [+"1"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -"1",
  Above =>
    class extends Above {
      before = 0;
      [-"1"] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  +true,
  Above =>
    class extends Above {
      before = 0;
      [+true] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  +null,
  Above =>
    class extends Above {
      before = 0;
      [+null] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "abc".length,
  Above =>
    class extends Above {
      before = 0;
      ["abc".length] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  "abc"[1],
  Above =>
    class extends Above {
      before = 0;
      ["abc"[1]] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -Infinity,
  Above =>
    class extends Above {
      before = 0;
      [-Infinity] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -count,
  Above =>
    class extends Above {
      before = 0;
      [-count] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -Numbers.one,
  Above =>
    class extends Above {
      before = 0;
      [-Numbers.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  !0,
  Above =>
    class extends Above {
      before = 0;
      [!0] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  void 0,
  Above =>
    class extends Above {
      before = 0;
      [void 0] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  null,
  Above =>
    class extends Above {
      before = 0;
      [null] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  undefined,
  Above =>
    class extends Above {
      before = 0;
      [undefined] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  true,
  Above =>
    class extends Above {
      before = 0;
      [true] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1n,
  Above =>
    class extends Above {
      before = 0;
      [1n] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1n,
  Above =>
    class extends Above {
      before = 0;
      [-1n] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  name(),
  Above =>
    class extends Above {
      before = 0;
      [name()] = 1;
      y = 2;
      optional?: number;
    },
);
