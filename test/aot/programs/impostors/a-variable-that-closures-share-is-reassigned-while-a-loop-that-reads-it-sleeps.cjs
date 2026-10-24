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
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
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
];

const values = { arrays, strings, numbers, functions, objects };

async function runMicrotask(use, results, change) {
  const running = use(results);
  if (change) Promise.resolve().then(() => {}).then(() => {}).then(change);
  return running;
}

async function runAsyncGenerator(use, results, change) {
  const generator = use(results);
  for (let i = 0; i < 6; i++) {
    if (i === 3 && change) change();
    await generator.next();
  }
  return (await generator.next()).value;
}

async function runTimer(use, results, change) {
  const running = use(results);
  let turns = 0;
  const wait = () => (++turns === 3 ? change() : setTimeout(wait, 0));
  if (change) setTimeout(wait, 0);
  return running;
}

function scope() {
  let a, s, n, f, o;
  const set = {
    arrays: value => {
      a = value;
    },
    strings: value => {
      s = value;
    },
    numbers: value => {
      n = value;
    },
    functions: value => {
      f = value;
    },
    objects: value => {
      o = value;
    },
  };

  async function pushesMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(a.push(i), a.length);
    }
    return "done";
  }

  async function iteratesMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      for (const x of a) results.push(x);
    }
    return "done";
  }

  async function readsCharCodeMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(s.charCodeAt(0));
    }
    return "done";
  }

  async function truncatesMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(n | 0);
    }
    return "done";
  }

  async function addsOneMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(n + 1);
    }
    return "done";
  }

  async function callsThroughCallMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(f.call(undefined, i));
    }
    return "done";
  }

  async function addsMembersMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      results.push(o.x + o.y);
    }
    return "done";
  }

  async function storesMemberMicrotask(results) {
    for (let i = 0; i < 6; i++) {
      await undefined;
      o.x = i;
      results.push(o.x);
    }
    return "done";
  }

  async function* pushesAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(a.push(i), a.length);
      yield i;
    }
    return "done";
  }

  async function* iteratesAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      for (const x of a) results.push(x);
      yield i;
    }
    return "done";
  }

  async function* readsCharCodeAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(s.charCodeAt(0));
      yield i;
    }
    return "done";
  }

  async function* truncatesAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(n | 0);
      yield i;
    }
    return "done";
  }

  async function* addsOneAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(n + 1);
      yield i;
    }
    return "done";
  }

  async function* callsThroughCallAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(f.call(undefined, i));
      yield i;
    }
    return "done";
  }

  async function* addsMembersAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      results.push(o.x + o.y);
      yield i;
    }
    return "done";
  }

  async function* storesMemberAsyncGenerator(results) {
    for (let i = 0; i < 6; i++) {
      o.x = i;
      results.push(o.x);
      yield i;
    }
    return "done";
  }

  async function pushesTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(a.push(i), a.length);
    }
    return "done";
  }

  async function iteratesTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const x of a) results.push(x);
    }
    return "done";
  }

  async function readsCharCodeTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(s.charCodeAt(0));
    }
    return "done";
  }

  async function truncatesTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(n | 0);
    }
    return "done";
  }

  async function addsOneTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(n + 1);
    }
    return "done";
  }

  async function callsThroughCallTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(f.call(undefined, i));
    }
    return "done";
  }

  async function addsMembersTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      results.push(o.x + o.y);
    }
    return "done";
  }

  async function storesMemberTimer(results) {
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      o.x = i;
      results.push(o.x);
    }
    return "done";
  }

  const table = [
    ["pushes Microtask", pushesMicrotask, runMicrotask, "arrays"],
    ["iterates Microtask", iteratesMicrotask, runMicrotask, "arrays"],
    ["readsCharCode Microtask", readsCharCodeMicrotask, runMicrotask, "strings"],
    ["truncates Microtask", truncatesMicrotask, runMicrotask, "numbers"],
    ["addsOne Microtask", addsOneMicrotask, runMicrotask, "numbers"],
    ["callsThroughCall Microtask", callsThroughCallMicrotask, runMicrotask, "functions"],
    ["addsMembers Microtask", addsMembersMicrotask, runMicrotask, "objects"],
    ["storesMember Microtask", storesMemberMicrotask, runMicrotask, "objects"],
    ["pushes AsyncGenerator", pushesAsyncGenerator, runAsyncGenerator, "arrays"],
    ["iterates AsyncGenerator", iteratesAsyncGenerator, runAsyncGenerator, "arrays"],
    ["readsCharCode AsyncGenerator", readsCharCodeAsyncGenerator, runAsyncGenerator, "strings"],
    ["truncates AsyncGenerator", truncatesAsyncGenerator, runAsyncGenerator, "numbers"],
    ["addsOne AsyncGenerator", addsOneAsyncGenerator, runAsyncGenerator, "numbers"],
    ["callsThroughCall AsyncGenerator", callsThroughCallAsyncGenerator, runAsyncGenerator, "functions"],
    ["addsMembers AsyncGenerator", addsMembersAsyncGenerator, runAsyncGenerator, "objects"],
    ["storesMember AsyncGenerator", storesMemberAsyncGenerator, runAsyncGenerator, "objects"],
    ["pushes Timer", pushesTimer, runTimer, "arrays"],
    ["iterates Timer", iteratesTimer, runTimer, "arrays"],
    ["readsCharCode Timer", readsCharCodeTimer, runTimer, "strings"],
    ["truncates Timer", truncatesTimer, runTimer, "numbers"],
    ["addsOne Timer", addsOneTimer, runTimer, "numbers"],
    ["callsThroughCall Timer", callsThroughCallTimer, runTimer, "functions"],
    ["addsMembers Timer", addsMembersTimer, runTimer, "objects"],
    ["storesMember Timer", storesMemberTimer, runTimer, "objects"],
  ];
  return { set, table };
}
const { set, table } = scope();

async function main() {
  console.log("strict:", (function () { return this === undefined; })());
  for (const [name, use, run, kind] of table) {
    const [[, honest], ...impostors] = values[kind];
    set[kind](honest());
    for (let i = 0; i < 50; i++) await run(use, [], null);
    for (const [label, make] of impostors) {
      set[kind](honest());
      const results = [];
      const end = await outcome(() => run(use, results, () => set[kind](make())));
      console.log(name + ": " + label + " -> " + show(results) + " " + end);
    }
  }
}

main();
