// Logs what node:stream and node:events read and store on a stream that is not itself a Proxy: an object below a Proxy of a stream,
// a stream whose own properties are accessors, and a stream with accessors on a prototype object of its own.
const stream = require("node:stream");
const EventEmitter = require("node:events");

function keyText(key) {
  return typeof key === "symbol" ? "[" + String(key.description) + "]" : key;
}

let traps = [];
function createLoggingProxy(target, name) {
  const prefix = name ? name + ":" : "";
  const handler = {
    set(target, key) {
      traps.push(prefix + "set " + keyText(key));
      const answer = Reflect.set(...arguments);
      const text = keyText(key);
      if (
        traps.at(-1) === prefix + "defineProperty " + text &&
        traps.at(-2) === prefix + "getOwnPropertyDescriptor " + text
      )
        traps.length -= 2;
      return answer;
    },
  };
  handler.get = function (target, key) {
    traps.push(prefix + keyText(key));
    return Reflect.get(...arguments);
  };
  for (const trap of ["has", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty"]) {
    handler[trap] = function (target, key) {
      traps.push(prefix + trap + " " + keyText(key));
      return Reflect[trap](...arguments);
    };
  }
  for (const trap of ["getPrototypeOf", "ownKeys", "isExtensible", "preventExtensions", "setPrototypeOf"]) {
    handler[trap] = function () {
      traps.push(prefix + trap);
      return Reflect[trap](...arguments);
    };
  }
  return new Proxy(target, handler);
}

function describe(value, receiver) {
  if (value === receiver && value !== undefined) return "this";
  if (value === null) return "null";
  if (typeof value === "object") {
    if (value instanceof Promise) value.catch(() => {});
    return "object";
  }
  if (typeof value === "function") return "function";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return String(value);
}
function describeError(error) {
  return "throws " + (error?.name ?? typeof error) + (error?.code !== undefined ? " " + error.code : "");
}

const turn = () => new Promise(resolve => setImmediate(resolve));
let late = [];
process.on("uncaughtException", error => late.push(describeError(error)));
process.on("unhandledRejection", error => late.push("rejected: " + describeError(error)));

function formatTraps(list) {
  if (list.length <= 16) return list.join(", ");
  let sum = 0x811c9dc5;
  for (let index = 16; index < list.length; index++) {
    const text = list[index];
    for (let at = 0; at < text.length; at++) sum = Math.imul(sum ^ text.charCodeAt(at), 0x01000193);
    sum = Math.imul(sum ^ 44, 0x01000193);
  }
  return list.slice(0, 16).join(", ") + ", +" + (list.length - 16) + " more (" + (sum >>> 0).toString(16) + ")";
}

const groups = new Map();
function print(subject, which, text) {
  let group = groups.get(subject);
  if (group === undefined) groups.set(subject, (group = new Map()));
  const cases = group.get(text);
  if (cases === undefined) group.set(text, [which]);
  else cases.push(which);
}
async function attempt(subject, which, body) {
  traps = [];
  late = [];
  let text;
  try {
    text = body();
  } catch (error) {
    text = describeError(error);
  }
  const now = traps;
  traps = [];
  for (let index = 0; index < 5; index++) await turn();
  const later = traps;
  traps = [];
  print(
    subject,
    which,
    text +
      (now.length ? " | " + formatTraps(now) : "") +
      (later.length ? " | later " + formatTraps(later) : "") +
      (late.length ? " | " + late.join(", ") : ""),
  );
}

const options = () => ({
  read() {},
  write(chunk, encoding, callback) {
    callback();
  },
  transform(chunk, encoding, callback) {
    callback(null, chunk);
  },
});
const quiet = made => {
  made.on("error", () => {});
  return made;
};
const classes = {
  Readable: stream.Readable,
  Writable: stream.Writable,
  Duplex: stream.Duplex,
  Transform: stream.Transform,
};
const make = name => quiet(new classes[name](options()));
const states = {
  fresh() {},
  filled(made) {
    if (made._writableState) made.write("w");
    if (made._readableState && !(made instanceof stream.Transform)) made.push("r");
  },
  ended(made) {
    if (made._writableState) made.end();
    if (made._readableState && !(made instanceof stream.Transform)) made.push(null);
  },
  destroyed(made) {
    made.destroy();
  },
};
const lists = {
  "()": () => [],
  '("a", 1)': () => ["a", 1],
  "(bytes, callback)": () => [Buffer.from("b"), function callback() {}],
  "(callback)": () => [function callback() {}],
};

function collectMembers(prototype) {
  const members = [];
  for (let level = prototype; level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const key of Reflect.ownKeys(level)) {
      if (key === "constructor" || members.some(member => member[0] === key)) continue;
      members.push([key, Reflect.getOwnPropertyDescriptor(level, key)]);
    }
  }
  return members;
}
function getInvocations(descriptor) {
  const invocations = [];
  if (typeof descriptor.get === "function") invocations.push(["get", receiver => descriptor.get.call(receiver)]);
  if (typeof descriptor.set === "function") invocations.push(["set", receiver => descriptor.set.call(receiver, 1)]);
  if (typeof descriptor.value === "function") {
    for (const list of Object.keys(lists))
      invocations.push([list, receiver => descriptor.value.apply(receiver, lists[list]())]);
  }
  return invocations;
}

function createAccessor(holder, key, held) {
  Object.defineProperty(holder, key, {
    configurable: true,
    enumerable: true,
    get() {
      traps.push(keyText(key));
      return held;
    },
    set(value) {
      traps.push("set " + keyText(key));
      held = value;
    },
  });
}
const innerNames = [
  "_events",
  "_eventsCount",
  "_maxListeners",
  "_readableState",
  "_writableState",
  "allowHalfOpen",
  "destroyed",
  "readable",
  "writable",
];
const observers = {
  "below a Proxy": made => Object.create(createLoggingProxy(made)),
  "own accessors"(made) {
    for (const key of Reflect.ownKeys(made)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(made, key);
      if ("value" in descriptor && descriptor.configurable) createAccessor(made, key, descriptor.value);
    }
    return made;
  },
  "accessors on a prototype"(made) {
    const between = Object.create(Object.getPrototypeOf(made));
    for (const key of innerNames)
      if (
        !Object.hasOwn(made, key) &&
        typeof Reflect.getOwnPropertyDescriptor(between, key) === "undefined" &&
        !(key in between)
      )
        createAccessor(between, key, undefined);
    Object.setPrototypeOf(made, between);
    return made;
  },
};

// STREAM_MEMBERS=all takes the constructors too, and these members, which wait for the end of the stream. STREAM_MEMBERS=rest takes only those.
const part = process.env.STREAM_MEMBERS ?? "most";
const waiting = ["[Symbol.asyncDispose]", "compose", "every", "find", "forEach", "reduce", "some", "toArray"];
const isTaken = key => part === "all" || waiting.includes(keyText(key)) === (part === "rest");

async function testReceivers() {
  for (const name of Object.keys(classes)) {
    for (const [key, descriptor] of collectMembers(classes[name].prototype)) {
      if (!isTaken(key)) continue;
      for (const [way, enter] of getInvocations(descriptor)) {
        const subject = name + " " + keyText(key) + " " + way;
        for (const state of Object.keys(states)) {
          for (const observer of Object.keys(observers)) {
            const made = make(name);
            states[state](made);
            if (state !== "fresh") await turn();
            const receiver = observers[observer](made);
            await attempt(subject, state + " " + observer, () => describe(enter(receiver), receiver));
            traps = [];
            try {
              stream.Stream.prototype.removeAllListeners.call(made);
              made.on("error", () => {});
              made.destroy();
            } catch {}
          }
        }
      }
    }
  }
}

async function testConstructors() {
  const given = {
    "()": () => [],
    "(options)": () => [options()],
    "(more options)": () => [
      { captureRejections: true, objectMode: true, highWaterMark: 1, emitClose: false, autoDestroy: false },
    ],
  };
  const receivers = {
    "below a Proxy of the prototype": constructor => Object.create(createLoggingProxy(constructor.prototype)),
    "below a Proxy of {}": () => Object.create(createLoggingProxy({})),
    "below accessors"(constructor) {
      const between = Object.create(constructor.prototype);
      for (const key of innerNames)
        if (!(key in between) || key.startsWith("_")) createAccessor(between, key, undefined);
      return Object.create(between);
    },
    "own accessors"(constructor) {
      const receiver = Object.create(constructor.prototype);
      for (const key of innerNames) if (key.startsWith("_")) createAccessor(receiver, key, undefined);
      return receiver;
    },
  };
  for (const [name, constructor] of [
    ["EventEmitter", EventEmitter],
    ["Stream", stream.Stream],
    ...Object.entries(classes),
    ["PassThrough", stream.PassThrough],
  ]) {
    for (const list of Object.keys(given)) {
      for (const which of Object.keys(receivers)) {
        await attempt(name + ".call " + list, which, () => {
          const receiver = receivers[which](constructor);
          const answer = constructor.apply(receiver, given[list]());
          const seen = traps;
          traps = [];
          const text = describe(answer, receiver) + " {" + Reflect.ownKeys(receiver).map(keyText).join(" ") + "}";
          traps = seen;
          return text;
        });
      }
    }
  }
}

(async function () {
  await testReceivers();
  if (part !== "most") await testConstructors();
  const lines = [];
  for (const [subject, group] of groups) {
    for (const [text, cases] of group) lines.push(subject + " [" + cases.join("; ") + "]: " + text);
  }
  console.log(lines.join("\n"));
  process.exit(0);
})();
