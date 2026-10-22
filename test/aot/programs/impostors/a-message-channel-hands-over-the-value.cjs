const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

async function outcome(run) {
  log.length = 0;
  try {
    const value = await run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

async function attempt(label, run) {
  console.log(label + " -> " + (await outcome(run)));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
  ["an array with a hole", () => [5, , 6]],
  ["a set", () => new Set([5, 6])],
  ["a map", () => new Map([[5, 6]])],
  ["a typed array", () => new Uint8Array([5, 6])],
  ["an object with a length", () => ({ 0: 5, length: 7 })],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
  ["a String object", () => new String("xyz")],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
  ["a Number object", () => new Number(3.5)],
  ["a Boolean object", () => new Boolean(true)],
  ["not a number", () => NaN],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
  ["an instance of a class", () => new (class Point { x = 1; y = 2; get z() { return 3; } })()],
];

function pushes(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const a = event.data;
        a.push(1);
        resolve([a.length]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function iterates(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const a = event.data;
        const seen = [];
        for (const x of a) seen.push(x);
        resolve([seen]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function readsCharCode(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const s = event.data;
        resolve([s.charCodeAt(0)]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function truncates(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const n = event.data;
        resolve([n | 0]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function addsOne(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const n = event.data;
        resolve([n + 1]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function calls(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const f = event.data;
        resolve([f(1)]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function addsMembers(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const o = event.data;
        resolve([o.x + o.y]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

function storesMember(given) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      try {
        const o = event.data;
        o.x = 1;
        resolve([o]);
      } catch (error) {
        reject(error);
      }
    };
    try {
      port1.postMessage(given);
    } catch (error) {
      port1.close();
      reject(error);
    }
  });
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

async function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) await attempt(round + " " + name + " " + label, () => use(make()));
  }
}

async function main() {
  console.log("strict:", (function () { return this === undefined; })());
  await everyCase("at first");
  for (let i = 0; i < 100; i++) {
    await pushes([5, 6]);
    await iterates([5, 6]);
    await readsCharCode("abc");
    await truncates(7);
    await addsOne(7);
    await addsMembers(({ x: 1, y: 2 }));
    await storesMember(({ x: 1, y: 2 }));
  }
  await everyCase("after 100");
}

main();
