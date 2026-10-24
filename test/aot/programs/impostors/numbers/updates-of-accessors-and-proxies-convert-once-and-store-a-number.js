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

function accessor(initial) {
  let stored = initial;
  return {
    get n() {
      log.push("get");
      return stored;
    },
    set n(value) {
      log.push("set " + show(value));
      stored = value;
    },
  };
}

function proxy(initial) {
  return new Proxy(
    { n: initial },
    {
      get(target, key) {
        log.push("get " + String(key));
        return target[key];
      },
      set(target, key, value) {
        log.push("set " + String(key) + " " + show(value));
        target[key] = value;
        return true;
      },
      has(target, key) {
        log.push("has " + String(key));
        return key in target;
      },
      getOwnPropertyDescriptor(target, key) {
        log.push("describe " + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      defineProperty(target, key, descriptor) {
        log.push("define " + String(key));
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  );
}

function converting(result) {
  return {
    valueOf() {
      log.push("valueOf");
      return result;
    },
  };
}

const updates = {
  "n++": holder => holder.n++,
  "++n": holder => ++holder.n,
  "n--": holder => holder.n--,
  "n += 1": holder => (holder.n += 1),
  "n -= 1": holder => (holder.n -= 1),
  "n *= 2": holder => (holder.n *= 2),
  "n |= 0": holder => (holder.n |= 0),
  "n >>>= 0": holder => (holder.n >>>= 0),
  "n ||= 5": holder => (holder.n ||= 5),
  "n &&= 5": holder => (holder.n &&= 5),
  "n ??= 5": holder => (holder.n ??= 5),
  "n += an object": holder => (holder.n += converting(1)),
  "['n']++": holder => holder["n"]++,
  "[an object]++": holder =>
    holder[
      {
        toString() {
          log.push("key");
          return "n";
        },
      }
    ]++,
};

const initials = { "1": () => 1, "'1'": () => "1", "undefined": () => undefined, "null": () => null, "0": () => 0, "1n": () => 1n, "2147483647": () => 2147483647, "-0": () => -0, "an object": () => converting(1), "an object that gives a text": () => converting("1") };

for (const name of Object.keys(updates)) for (let i = 0; i < 300; i++) updates[name]({ n: i });
for (const [kind, make] of [["accessor", accessor], ["proxy", proxy]]) {
  for (const name of Object.keys(updates)) {
    for (const initial of Object.keys(initials)) {
      log.length = 0;
      const result = outcome(() => updates[name](make(initials[initial]())));
      console.log(kind, name, "from", initial, "->", result, "after", log.join(", "));
    }
  }
}
