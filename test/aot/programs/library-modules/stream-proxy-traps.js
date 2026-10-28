// Logs every Proxy trap that node:stream triggers on a stream used as a receiver, a constructor target, or an argument.
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
      if (traps.at(-1) === prefix + "defineProperty " + text && traps.at(-2) === prefix + "getOwnPropertyDescriptor " + text) traps.length -= 2;
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
  if (list.length <= 48) return list.join(", ");
  let sum = 0x811c9dc5;
  for (let index = 48; index < list.length; index++) {
    const text = list[index];
    for (let at = 0; at < text.length; at++) sum = Math.imul(sum ^ text.charCodeAt(at), 0x01000193);
    sum = Math.imul(sum ^ 44, 0x01000193);
  }
  return list.slice(0, 48).join(", ") + ", +" + (list.length - 48) + " more (" + (sum >>> 0).toString(16) + ")";
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
  print(subject, which, text + (now.length ? " | " + formatTraps(now) : "") + (later.length ? " | later " + formatTraps(later) : "") + (late.length ? " | " + late.join(", ") : ""));
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
    for (const list of Object.keys(lists)) invocations.push([list, receiver => descriptor.value.apply(receiver, lists[list]())]);
  }
  return invocations;
}

async function testReceivers() {
  for (const name of Object.keys(classes)) {
    for (const [key, descriptor] of collectMembers(classes[name].prototype)) {
      for (const [way, enter] of getInvocations(descriptor)) {
        const subject = name + " " + keyText(key) + " " + way;
        for (const state of Object.keys(states)) {
          const made = make(name);
          states[state](made);
          if (state !== "fresh") await turn();
          const receiver = createLoggingProxy(made);
          await attempt(subject, state, () => describe(enter(receiver), receiver));
          made.destroy();
        }
        for (const [which, target] of [
          ["{}", {}],
          ["Object.create(prototype)", Object.create(classes[name].prototype)],
        ]) {
          const receiver = createLoggingProxy(target);
          await attempt(subject, which, () => describe(enter(receiver), receiver));
        }
      }
    }
  }
}

async function testConstructors() {
  const given = {
    "()": () => [],
    "(options)": () => [options()],
    "(proxied options)": () => [createLoggingProxy(options(), "options")],
    "(more options)": () => [{ captureRejections: true, objectMode: true, highWaterMark: 1, emitClose: false, autoDestroy: false }],
  };
  for (const [name, constructor] of [["EventEmitter", EventEmitter], ["Stream", stream.Stream], ...Object.entries(classes), ["PassThrough", stream.PassThrough]]) {
    for (const list of Object.keys(given)) {
      for (const [which, target] of [
        ["Object.create(prototype)", () => Object.create(constructor.prototype)],
        ["{}", () => ({})],
      ]) {
        await attempt(name + ".call " + list, which, () => {
          const inner = target();
          const receiver = createLoggingProxy(inner);
          const answer = constructor.apply(receiver, given[list]());
          return describe(answer, receiver) + " {" + Reflect.ownKeys(inner).map(keyText).join(" ") + "}";
        });
      }
    }
  }
}

async function testArguments() {
  const holders = { stream, Readable: stream.Readable, Writable: stream.Writable, Duplex: stream.Duplex, promises: stream.promises };
  for (const holderName of Object.keys(holders)) {
    const holder = holders[holderName];
    for (const key of Reflect.ownKeys(holder)) {
      const callee = Reflect.getOwnPropertyDescriptor(holder, key).value;
      const text = keyText(key);
      if (typeof callee !== "function" || /^[A-Z]/.test(text) || /DefaultHighWaterMark$/.test(text)) continue;
      for (const name of Object.keys(classes)) {
        for (const state of Object.keys(states)) {
          for (const [form, list] of [
            ["(proxy)", it => [it]],
            ["(proxy, callback)", it => [it, function callback() {}]],
          ]) {
            const made = make(name);
            states[state](made);
            await turn();
            await attempt(holderName + "." + text + form, name + " " + state, () => describe(callee.apply(holder, list(createLoggingProxy(made)))));
            made.destroy();
          }
        }
        const forms = {
          "(proxy, proxy, callback)": (it, another) => [createLoggingProxy(it, "first"), createLoggingProxy(another, "second"), function callback() {}],
          "(signal, proxy)": it => [new AbortController().signal, createLoggingProxy(it)],
          "(stream, proxied options)": it => [it, createLoggingProxy({}, "options")],
        };
        for (const form of Object.keys(forms)) {
          const made = make(name);
          const another = make("Transform");
          await attempt(holderName + "." + text + form, name, () => describe(callee.apply(holder, forms[form](made, another))));
          made.destroy();
          another.destroy();
        }
      }
    }
  }
  const acts = {
    pipe() {},
    "pipe, push twice"(source) {
      source.push("one");
      source.push("two");
    },
    "pipe, push, end"(source) {
      source.push("one");
      source.push(null);
    },
    "pipe, unpipe"(source, destination) {
      source.unpipe(destination);
    },
    "pipe, destroy"(source) {
      source.destroy();
    },
    "pipe twice, push"(source) {
      source.pipe(make("Writable"));
      source.push("one");
    },
  };
  for (const from of ["Readable", "Duplex"]) {
    for (const to of ["Writable", "Duplex", "Transform"]) {
      for (const state of Object.keys(states)) {
        for (const act of Object.keys(acts)) {
          const source = make(from);
          const made = make(to);
          states[state](made);
          await turn();
          const destination = createLoggingProxy(made);
          await attempt(from + ": " + act, "dest " + to + " " + state, () => {
            const answer = source.pipe(destination);
            acts[act](source, destination);
            return String(answer === destination);
          });
          source.destroy();
          made.destroy();
        }
      }
    }
  }
}

(async function () {
  await testReceivers();
  await testConstructors();
  await testArguments();
  const lines = [];
  for (const [subject, group] of groups) {
    for (const [text, cases] of group) lines.push(subject + " [" + cases.join("; ") + "]: " + text);
  }
  console.log(lines.join("\n"));
  process.exit(0);
})();
