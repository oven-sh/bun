// Functions and classes that stand under a key in brackets whose value is written there: what console.log, Bun.inspect and util.inspect print for each, its `name`, its own keys, its instances and its frame in a stack trace.
import util from "node:util";

enum Color {
  Red,
  Green = "green",
}
const enum Fixed {
  One = 1,
  Text = "text",
}
const constantText = "constantText";
const described = Symbol("described");

function fail(): never {
  throw new Error("x");
}

function framesOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    const lines = String((error as Error).stack).split("\n");
    return lines
      .slice(2, 4)
      .map(line =>
        line
          .trim()
          .replace(/ ?\(.*\)$/, "")
          .replace(/at (?:[A-Z]:)?[\\/].*$/, "at <file>"),
      )
      .join(" < ");
  }
  return "nothing thrown";
}

function show(label: string, value: any, call?: () => unknown) {
  console.log(label, "|", value, "|", Bun.inspect(value), "|", util.inspect(value), "|", JSON.stringify(value.name));
  console.log(
    " ",
    Object.getOwnPropertyNames(value).join(),
    "|",
    JSON.stringify(Object.getOwnPropertyDescriptor(value, "name")),
  );
  if (call) console.log("  frames:", framesOf(call));
}

function showMembers(label: string, holder: any, receiver: any = holder) {
  for (const key of Reflect.ownKeys(holder)) {
    if (key === "constructor" || key === "prototype" || key === "length" || key === "name") continue;
    const { value, get, set } = Object.getOwnPropertyDescriptor(holder, key)!;
    const name = `${label} ${String(key)}`;
    if (get) show(`${name} getter`, get, () => receiver[key]);
    if (set) show(`${name} setter`, set, () => (receiver[key] = 1));
    if (typeof value !== "function") continue;
    const isClass = /^class/.test(Function.prototype.toString.call(value));
    show(name, value, () => {
      const answer = isClass ? new value() : receiver[key]();
      return typeof answer?.next === "function" ? answer.next() : answer;
    });
    if (isClass) console.log("  instance:", Object.create(value.prototype), value.prototype);
  }
  console.log(label, holder);
}

showMembers("methods", {
  [7]() {
    fail();
  },
  [-1024]() {
    fail();
  },
  [1.5]() {
    fail();
  },
  [NaN]() {
    fail();
  },
  [0 / 0 + 1]() {
    fail();
  },
  [-0]() {
    fail();
  },
  [-Infinity]() {
    fail();
  },
  [1e21]() {
    fail();
  },
  ["k"]() {
    fail();
  },
  [""]() {
    fail();
  },
  ["two words"]() {
    fail();
  },
  ["a" + "b"]() {
    fail();
  },
  [`t`]() {
    fail();
  },
  [`t${1}`]() {
    fail();
  },
  ["__proto__"]() {
    fail();
  },
  ["p"]() {
    fail();
  },
  ["s" as string]() {
    fail();
  },
  [true ? "c" : "d"]() {
    fail();
  },
  [typeof 1]() {
    fail();
  },
  [constantText]() {
    fail();
  },
  [Color.Red + 100]() {
    fail();
  },
  [Color.Green]() {
    fail();
  },
  [Fixed.One + 200]() {
    fail();
  },
  [Fixed.Text]() {
    fail();
  },
  [Symbol.iterator]() {
    fail();
  },
  [Symbol.asyncIterator]() {
    fail();
  },
  [described]() {
    fail();
  },
  written() {
    fail();
  },
  8() {
    fail();
  },
  "quoted"() {
    fail();
  },
});

showMembers("values", {
  ["arrow"]: () => {
    fail();
  },
  ["function"]: function () {
    fail();
  },
  ["named"]: function own() {
    fail();
  },
  ["class"]: class {
    constructor() {
      fail();
    }
  },
  ["derived"]: class extends Object {
    constructor() {
      super();
      fail();
    }
  },
  ["named class"]: class Own {
    constructor() {
      fail();
    }
  },
  ["class with a name"]: class {
    static name = "static";
    constructor() {
      fail();
    }
  },
  ["parenthesized"]: () => {
    fail();
  },
  ["async arrow"]: async () => {},
  ["async function"]: async function () {},
  ["generator function"]: function* () {
    fail();
  },
  ["async generator function"]: async function* () {},
  [1]: () => {
    fail();
  },
  [2]: class {
    constructor() {
      fail();
    }
  },
  [NaN]: function () {
    fail();
  },
  [Symbol.iterator]: () => {
    fail();
  },
  [Symbol.hasInstance]: class {
    constructor() {
      fail();
    }
  },
  writtenArrow: () => {
    fail();
  },
  writtenClass: class {
    constructor() {
      fail();
    }
  },
});

showMembers("kinds of methods", {
  async ["async"]() {},
  *["generator"]() {
    fail();
  },
  async *["async generator"]() {},
  get ["accessor"]() {
    return fail();
  },
  set ["accessor"](value) {
    fail();
  },
  get [3]() {
    return fail();
  },
  set [3](value) {
    fail();
  },
  get [Symbol.toStringTag]() {
    return fail();
  },
});

class Members {
  ["method"]() {
    fail();
  }
  [4]() {
    fail();
  }
  [NaN]() {
    fail();
  }
  async ["async"]() {}
  *["generator"]() {
    fail();
  }
  async *["async generator"]() {}
  get ["accessor"]() {
    return fail();
  }
  set ["accessor"](value) {
    fail();
  }
  [Color.Green]() {
    fail();
  }
  [Symbol.iterator]() {
    fail();
  }
  written() {
    fail();
  }
  static ["method"]() {
    fail();
  }
  static [5]() {
    fail();
  }
  static *["generator"]() {
    fail();
  }
  static get ["accessor"]() {
    return fail();
  }
  static set ["accessor"](value) {
    fail();
  }
  static [Symbol.iterator]() {
    fail();
  }
  static written() {
    fail();
  }
}
showMembers("members", Members.prototype, new Members());
showMembers("static members", Members);

class Fields {
  ["arrow"] = () => {
    fail();
  };
  ["function"] = function () {
    fail();
  };
  ["class"] = class {
    constructor() {
      fail();
    }
  };
  [6] = () => {
    fail();
  };
  [Symbol.iterator] = () => {
    fail();
  };
  written = () => {
    fail();
  };
  static ["arrow"] = () => {
    fail();
  };
  static ["function"] = function () {
    fail();
  };
  static ["class"] = class {
    constructor() {
      fail();
    }
  };
  static [9] = () => {
    fail();
  };
  static written = () => {
    fail();
  };
}
showMembers("fields", new Fields());
showMembers("static fields", Fields);

function make(round: number) {
  return {
    ["made"]() {
      return round;
    },
    ["kept"]: () => round,
  };
}
const first = make(1);
const second = make(2);
console.log(first, second, first.made === second.made, first.made.name, second.kept.name, first.made(), second.kept());
Object.defineProperty(first.made, "name", { value: "renamed" });
console.log(first, first.made.name, second.made.name);
