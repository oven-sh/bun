const nameOf = key => (typeof key === "symbol" ? "@" + key.description : String(key));
function watched(target, label, log) {
  return new Proxy(target, {
    get(held, key) {
      log.push(label + "." + nameOf(key));
      const found = Reflect.get(held, key, held);
      return label === "e" && Array.isArray(found) ? watched(found, "l", log) : found;
    },
    set(held, key, value) {
      log.push(label + "." + nameOf(key) + "=");
      return Reflect.set(held, key, value, held);
    },
    has(held, key) {
      log.push(label + " has " + nameOf(key));
      return Reflect.has(held, key);
    },
    getPrototypeOf(held) {
      log.push(label + " above");
      return Reflect.getPrototypeOf(held);
    },
    deleteProperty(held, key) {
      log.push(label + " delete " + nameOf(key));
      return Reflect.deleteProperty(held, key);
    },
    defineProperty(held, key, descriptor) {
      log.push(label + " define " + nameOf(key));
      return Reflect.defineProperty(held, key, descriptor);
    },
    getOwnPropertyDescriptor(held, key) {
      log.push(label + " describe " + nameOf(key));
      return Reflect.getOwnPropertyDescriptor(held, key);
    },
    ownKeys(held) {
      log.push(label + " keys");
      return Reflect.ownKeys(held);
    },
  });
}
function watch(stream, log, what) {
  if (what.includes("r") && stream._readableState) stream._readableState = watched(stream._readableState, "r", log);
  if (what.includes("w") && stream._writableState) stream._writableState = watched(stream._writableState, "w", log);
  if (what.includes("e") && stream._events) stream._events = watched(stream._events, "e", log);
  if (what.includes("a")) {
    for (const key of Reflect.ownKeys(stream)) {
      let held = stream[key];
      Object.defineProperty(stream, key, {
        configurable: true,
        enumerable: true,
        get() {
          log.push("s." + nameOf(key));
          return held;
        },
        set(value) {
          log.push("s." + nameOf(key) + "=");
          held = value;
        },
      });
    }
  }
  if (what.includes("p")) {
    Object.setPrototypeOf(
      stream,
      new Proxy(Object.getPrototypeOf(stream), {
        get(above, key, receiver) {
          log.push("p." + nameOf(key));
          return Reflect.get(above, key, receiver);
        },
        set(above, key, value, receiver) {
          log.push("p." + nameOf(key) + "=");
          return Reflect.set(above, key, value, receiver);
        },
        has(above, key) {
          log.push("p has " + nameOf(key));
          return Reflect.has(above, key);
        },
        getPrototypeOf(above) {
          log.push("p above");
          return Reflect.getPrototypeOf(above);
        },
      }),
    );
  }
  return stream;
}
const turns = count => new Promise(done => (function turn(left) { left ? setImmediate(turn, left - 1) : done(); })(count));
function shorten(log) {
  const out = [];
  for (const entry of log) {
    const last = out[out.length - 1];
    if (last && last[0] === entry) last[1]++;
    else out.push([entry, 1]);
  }
  return out.map(([entry, times]) => (times > 1 ? entry + "*" + times : entry)).join(" ");
}
process.on("uncaughtException", error => console.log("uncaught", error && error.constructor.name, error && error.code));
async function run(cases, kinds) {
  for (const what of kinds) {
    for (const [label, work] of cases) {
      const log = [];
      const mark = word => log.push("|" + word + "|");
      try {
        await work(log, what, mark);
        await turns(4);
      } catch (error) {
        log.push("threw " + (error && error.constructor.name) + " " + (error && error.code));
      }
      console.log(what + " " + label + ": " + log.length + ": " + shorten(log));
    }
  }
}
module.exports = { watch, turns, run };
