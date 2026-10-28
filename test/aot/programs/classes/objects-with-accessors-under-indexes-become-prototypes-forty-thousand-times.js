// Forty thousand times over, an object with an accessor or a constant under an index is or becomes a prototype. Arrays and objects with elements that lie below one of them, and those that do not, answer as in plain Bun.
const times = 40_000;
const log = [];

function store(target, value) {
  try {
    target[3] = value;
  } catch (error) {
    log.push(`${error.constructor.name} for ${value}`);
  }
}

const ways = {
  "a class with a setter"() {
    return class {
      set [3](value) {
        log.push(value);
      }
    }.prototype;
  },
  "a class with a getter"() {
    return class {
      get 3() {
        return "from the getter";
      }
    }.prototype;
  },
  "a class whose prototype object is given a constant"() {
    const prototype = class {}.prototype;
    Object.defineProperty(prototype, 3, { value: "constant", writable: false });
    return prototype;
  },
  "a class whose prototype object has elements before the setter"() {
    const prototype = class {}.prototype;
    prototype[0] = "first";
    prototype[1] = "second";
    Object.defineProperty(prototype, 3, {
      set(value) {
        log.push(value);
      },
    });
    return prototype;
  },
  "a function whose prototype object is given a setter"() {
    function Made() {}
    Object.defineProperty(Made.prototype, 3, {
      set(value) {
        log.push(value);
      },
    });
    return Made.prototype;
  },
  "a literal with a setter that Object.create puts above an object"() {
    const prototype = {
      set [3](value) {
        log.push(value);
      },
    };
    Object.create(prototype);
    return prototype;
  },
  "an object above which a literal with a setter is put"() {
    const prototype = Object.create(null);
    Object.create(prototype);
    Object.setPrototypeOf(prototype, {
      set [3](value) {
        log.push(value);
      },
    });
    return prototype;
  },
};

for (const [name, make] of Object.entries(ways)) {
  const apart = [1, 2, 3];
  const early = make();
  const belowEarly = Object.setPrototypeOf(["a", "b"], early);
  const withElements = Object.create(early);
  withElements[0] = "zero";
  let last;
  for (let i = 0; i < times; i++) last = make();
  const belowLast = Object.setPrototypeOf(["c"], last);

  log.length = 0;
  store(apart, "apart");
  store(belowEarly, "below the first");
  store(withElements, "an object below the first");
  store(belowLast, "below the last");
  store(early, "the first itself");
  store(last, "the last itself");
  console.log(name);
  console.log("  the stores", JSON.stringify(log));
  console.log("  apart", JSON.stringify(apart), apart.length);
  console.log(
    "  below the first",
    JSON.stringify(belowEarly),
    belowEarly.length,
    Object.hasOwn(belowEarly, 3),
    belowEarly[3],
  );
  console.log(
    "  an object below the first",
    JSON.stringify(withElements),
    Object.hasOwn(withElements, 3),
    withElements[3],
  );
  console.log(
    "  below the last",
    JSON.stringify(belowLast),
    belowLast.length,
    Object.hasOwn(belowLast, 3),
    belowLast[3],
  );
  console.log(
    "  own keys",
    JSON.stringify(Reflect.ownKeys(early).map(String)),
    JSON.stringify(Reflect.ownKeys(last).map(String)),
  );
}
