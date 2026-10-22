function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const log = [];

function area(box) {
  return box.width * box.height;
}

function areaOfInt32(box) {
  return (box.width | 0) * (box.height | 0);
}

function areaByPattern({ width, height }) {
  return width * height;
}

function areaByPatternWithDefaults({ width = 2, height = 3 }) {
  return width * height;
}

function perimeter(box) {
  const { width, height } = box;
  return (width + height) << 1;
}

function grown(box) {
  box.width++;
  box.height += 1;
  return [box.width, box.height];
}

const uses = [area, areaOfInt32, areaByPattern, areaByPatternWithDefaults, perimeter, grown];
const boxes = {
  "plain": () => ({ width: 4, height: 5 }),
  "the other key order": () => ({ height: 5, width: 4 }),
  "an extra member first": () => ({ depth: 1, width: 4, height: 5 }),
  "own getters": () => ({
    get width() {
      log.push("width");
      return 4;
    },
    get height() {
      log.push("height");
      return 5;
    },
  }),
  "getters that return texts": () => ({
    get width() {
      log.push("width");
      return "4";
    },
    get height() {
      log.push("height");
      return "5";
    },
  }),
  "a getter that counts up": () => {
    let n = 0;
    return {
      get width() {
        return ++n;
      },
      set width(value) {
        log.push("set width " + value);
      },
      height: 5,
    };
  },
  "getters on the prototype": () =>
    Object.create({
      get width() {
        log.push("inherited width");
        return 4;
      },
      get height() {
        log.push("inherited height");
        return 5;
      },
    }),
  "values on the prototype": () => Object.create({ width: 4, height: 5 }),
  "a class with getters": () =>
    new (class {
      #w = 4;
      get width() {
        return this.#w;
      }
      set width(value) {
        this.#w = value * 10;
      }
      get height() {
        return 5;
      }
    })(),
  "a proxy that logs": () =>
    new Proxy(
      { width: 4, height: 5 },
      {
        get(target, key, receiver) {
          log.push("get " + String(key));
          return Reflect.get(target, key, receiver);
        },
        set(target, key, value, receiver) {
          log.push("set " + String(key) + " " + value);
          return Reflect.set(target, key, value, receiver);
        },
      },
    ),
  "a proxy that answers with fractions": () => new Proxy({}, { get: () => 1.5, set: () => true }),
  "a null prototype": () => Object.assign(Object.create(null), { width: 4, height: 5 }),
  "frozen": () => Object.freeze({ width: 4, height: 5 }),
  "one member missing": () => ({ width: 4 }),
  "one member undefined": () => ({ width: 4, height: undefined }),
  "one member null": () => ({ width: 4, height: null }),
  "fractions": () => ({ width: 0.5, height: 5 }),
  "large integers": () => ({ width: 2147483647, height: 2147483647 }),
  "objects with valueOf": () => ({
    width: {
      valueOf() {
        log.push("width valueOf");
        return 4;
      },
    },
    height: {
      valueOf() {
        log.push("height valueOf");
        return 5;
      },
    },
  }),
  "bigints": () => ({ width: 4n, height: 5n }),
  "a bigint and a number": () => ({ width: 4n, height: 5 }),
  "an array": () => Object.assign([], { width: 4, height: 5 }),
  "a function": () => Object.assign(function () {}, { width: 4, height: 5 }),
  "a text": () => "text",
  "a number": () => 7,
};

for (let i = 0; i < 2000; i++) for (const use of uses) use({ width: i, height: 2 });
for (const use of uses) {
  for (const name of Object.keys(boxes)) {
    log.length = 0;
    const result = outcome(() => use(boxes[name]()));
    console.log(use.name, "of", name, "->", result + (log.length ? " after " + log.join(", ") : ""));
  }
  attempt(use.name + " of null", () => use(null));
  attempt(use.name + " of undefined", () => use(undefined));
  attempt(use.name + " of a plain box again", () => use({ width: 4, height: 5 }));
}
