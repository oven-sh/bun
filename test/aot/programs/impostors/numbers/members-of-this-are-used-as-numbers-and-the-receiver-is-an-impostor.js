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

function area() {
  return this.width * this.height;
}

function flagsOf() {
  return this.flags & 3;
}

function bump() {
  this.count++;
  return this.count;
}

function grow(by) {
  this.size += by;
  return this.size;
}

const honest = { width: 2, height: 3, flags: 7, count: 0, size: 0, area, flagsOf, bump, grow };
for (let i = 0; i < 2000; i++) {
  honest.area();
  honest.flagsOf();
  honest.bump();
  honest.grow(1);
}
console.log("after 2000 honest calls", honest.count, honest.size);

const receivers = {
  "texts": () => ({ width: "2", height: "3", flags: "7", count: "0", size: "0" }),
  "fractions": () => ({ width: 2.5, height: 3.5, flags: 7.9, count: 0.5, size: 0.5 }),
  "nothing": () => ({}),
  "nulls": () => ({ width: null, height: null, flags: null, count: null, size: null }),
  "bigints": () => ({ width: 2n, height: 3n, flags: 7n, count: 0n, size: 0n }),
  "the largest int32": () => ({ width: 2147483647, height: 2, flags: 2147483647, count: 2147483647, size: 2147483647 }),
  "objects": () => {
    const member = (name, result) => ({
      valueOf() {
        log.push(name);
        return result;
      },
    });
    return { width: member("width", 2), height: member("height", 3), flags: member("flags", 7), count: member("count", 0), size: member("size", 0) };
  },
  "getters": () => ({
    get width() {
      log.push("get width");
      return 2;
    },
    get height() {
      log.push("get height");
      return 3;
    },
    get flags() {
      log.push("get flags");
      return 7;
    },
    get count() {
      log.push("get count");
      return 0;
    },
    set count(value) {
      log.push("set count " + value);
    },
    get size() {
      log.push("get size");
      return "0";
    },
    set size(value) {
      log.push("set size " + value);
    },
  }),
  "an array": () => [1, 2, 3],
  "a text": () => "text",
  "a number": () => 5,
  "a function": () => function (a, b) {},
  "a frozen object": () => Object.freeze({ width: 2, height: 3, flags: 7, count: 0, size: 0 }),
  "null": () => null,
  "undefined": () => undefined,
};

for (const name of Object.keys(receivers)) {
  for (const [label, use] of [["area", area], ["flagsOf", flagsOf], ["bump", bump], ["grow", grow]]) {
    log.length = 0;
    const result = outcome(() => use.call(receivers[name](), 1));
    console.log(label, "on", name, "->", result + (log.length ? " after " + log.join(", ") : ""));
  }
}
attempt("grow by a text", () => grow.call({ size: 1 }, "1"));
attempt("grow by nothing", () => grow.call({ size: 1 }));
attempt("the honest object afterwards", () => [honest.area(), honest.flagsOf(), honest.bump(), honest.grow(1)]);
