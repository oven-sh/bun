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

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
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

function runCallback(use, results, change) {
  return use(results, i => {
    if (i === 3 && change) change();
  });
}

function runGetter(use, results, change) {
  let reads = 0;
  return use(results, {
    get now() {
      if (reads++ === 3 && change) change();
      return reads;
    },
  });
}

function runValueOf(use, results, change) {
  let conversions = 0;
  return use(results, {
    valueOf() {
      if (++conversions === 3 && change) change();
      return 1;
    },
  });
}

function runHasTrap(use, results, change) {
  return use(results, new Proxy({}, {
    has(target, key) {
      if (key === "3" && change) change();
      return Number(key) < 6;
    },
  }));
}

function runGenerator(use, results, change) {
  const generator = use(results);
  for (let i = 0; i < 6; i++) {
    if (i === 3 && change) change();
    generator.next();
  }
  return generator.next().value;
}

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

function pushesCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(a.push(i), a.length);
  }
  return "done";
}

function iteratesCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    for (const x of a) results.push(x);
  }
  return "done";
}

function readsCharCodeCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(s.charCodeAt(0));
  }
  return "done";
}

function truncatesCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(n | 0);
  }
  return "done";
}

function addsOneCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(n + 1);
  }
  return "done";
}

function callsThroughCallCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(f.call(undefined, i));
  }
  return "done";
}

function addsMembersCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(o.x + o.y);
  }
  return "done";
}

function storesMemberCallback(results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    o.x = i;
    results.push(o.x);
  }
  return "done";
}

function pushesGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(a.push(i), a.length);
  }
  return "done";
}

function iteratesGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    for (const x of a) results.push(x);
  }
  return "done";
}

function readsCharCodeGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(s.charCodeAt(0));
  }
  return "done";
}

function truncatesGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(n | 0);
  }
  return "done";
}

function addsOneGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(n + 1);
  }
  return "done";
}

function callsThroughCallGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(f.call(undefined, i));
  }
  return "done";
}

function addsMembersGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    results.push(o.x + o.y);
  }
  return "done";
}

function storesMemberGetter(results, clock) {
  for (let i = 0; i < 6; i++) {
    if (clock.now > 100) break;
    o.x = i;
    results.push(o.x);
  }
  return "done";
}

function pushesValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(a.push(i), a.length);
  }
  return "done";
}

function iteratesValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    for (const x of a) results.push(x);
  }
  return "done";
}

function readsCharCodeValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(s.charCodeAt(0));
  }
  return "done";
}

function truncatesValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(n | 0);
  }
  return "done";
}

function addsOneValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(n + 1);
  }
  return "done";
}

function callsThroughCallValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(f.call(undefined, i));
  }
  return "done";
}

function addsMembersValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    results.push(o.x + o.y);
  }
  return "done";
}

function storesMemberValueOf(results, step) {
  for (let i = 0; i < 6; i += step) {
    o.x = i;
    results.push(o.x);
  }
  return "done";
}

function pushesHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(a.push(i), a.length);
  }
  return "done";
}

function iteratesHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    for (const x of a) results.push(x);
  }
  return "done";
}

function readsCharCodeHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(s.charCodeAt(0));
  }
  return "done";
}

function truncatesHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(n | 0);
  }
  return "done";
}

function addsOneHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(n + 1);
  }
  return "done";
}

function callsThroughCallHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(f.call(undefined, i));
  }
  return "done";
}

function addsMembersHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    results.push(o.x + o.y);
  }
  return "done";
}

function storesMemberHasTrap(results, allowed) {
  for (let i = 0; i in allowed; i++) {
    o.x = i;
    results.push(o.x);
  }
  return "done";
}

function* pushesGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(a.push(i), a.length);
    yield i;
  }
  return "done";
}

function* iteratesGenerator(results) {
  for (let i = 0; i < 6; i++) {
    for (const x of a) results.push(x);
    yield i;
  }
  return "done";
}

function* readsCharCodeGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(s.charCodeAt(0));
    yield i;
  }
  return "done";
}

function* truncatesGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(n | 0);
    yield i;
  }
  return "done";
}

function* addsOneGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(n + 1);
    yield i;
  }
  return "done";
}

function* callsThroughCallGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(f.call(undefined, i));
    yield i;
  }
  return "done";
}

function* addsMembersGenerator(results) {
  for (let i = 0; i < 6; i++) {
    results.push(o.x + o.y);
    yield i;
  }
  return "done";
}

function* storesMemberGenerator(results) {
  for (let i = 0; i < 6; i++) {
    o.x = i;
    results.push(o.x);
    yield i;
  }
  return "done";
}

const table = [
  ["pushes Callback", pushesCallback, runCallback, "arrays"],
  ["iterates Callback", iteratesCallback, runCallback, "arrays"],
  ["readsCharCode Callback", readsCharCodeCallback, runCallback, "strings"],
  ["truncates Callback", truncatesCallback, runCallback, "numbers"],
  ["addsOne Callback", addsOneCallback, runCallback, "numbers"],
  ["callsThroughCall Callback", callsThroughCallCallback, runCallback, "functions"],
  ["addsMembers Callback", addsMembersCallback, runCallback, "objects"],
  ["storesMember Callback", storesMemberCallback, runCallback, "objects"],
  ["pushes Getter", pushesGetter, runGetter, "arrays"],
  ["iterates Getter", iteratesGetter, runGetter, "arrays"],
  ["readsCharCode Getter", readsCharCodeGetter, runGetter, "strings"],
  ["truncates Getter", truncatesGetter, runGetter, "numbers"],
  ["addsOne Getter", addsOneGetter, runGetter, "numbers"],
  ["callsThroughCall Getter", callsThroughCallGetter, runGetter, "functions"],
  ["addsMembers Getter", addsMembersGetter, runGetter, "objects"],
  ["storesMember Getter", storesMemberGetter, runGetter, "objects"],
  ["pushes ValueOf", pushesValueOf, runValueOf, "arrays"],
  ["iterates ValueOf", iteratesValueOf, runValueOf, "arrays"],
  ["readsCharCode ValueOf", readsCharCodeValueOf, runValueOf, "strings"],
  ["truncates ValueOf", truncatesValueOf, runValueOf, "numbers"],
  ["addsOne ValueOf", addsOneValueOf, runValueOf, "numbers"],
  ["callsThroughCall ValueOf", callsThroughCallValueOf, runValueOf, "functions"],
  ["addsMembers ValueOf", addsMembersValueOf, runValueOf, "objects"],
  ["storesMember ValueOf", storesMemberValueOf, runValueOf, "objects"],
  ["pushes HasTrap", pushesHasTrap, runHasTrap, "arrays"],
  ["iterates HasTrap", iteratesHasTrap, runHasTrap, "arrays"],
  ["readsCharCode HasTrap", readsCharCodeHasTrap, runHasTrap, "strings"],
  ["truncates HasTrap", truncatesHasTrap, runHasTrap, "numbers"],
  ["addsOne HasTrap", addsOneHasTrap, runHasTrap, "numbers"],
  ["callsThroughCall HasTrap", callsThroughCallHasTrap, runHasTrap, "functions"],
  ["addsMembers HasTrap", addsMembersHasTrap, runHasTrap, "objects"],
  ["storesMember HasTrap", storesMemberHasTrap, runHasTrap, "objects"],
  ["pushes Generator", pushesGenerator, runGenerator, "arrays"],
  ["iterates Generator", iteratesGenerator, runGenerator, "arrays"],
  ["readsCharCode Generator", readsCharCodeGenerator, runGenerator, "strings"],
  ["truncates Generator", truncatesGenerator, runGenerator, "numbers"],
  ["addsOne Generator", addsOneGenerator, runGenerator, "numbers"],
  ["callsThroughCall Generator", callsThroughCallGenerator, runGenerator, "functions"],
  ["addsMembers Generator", addsMembersGenerator, runGenerator, "objects"],
  ["storesMember Generator", storesMemberGenerator, runGenerator, "objects"],
];

console.log("strict:", (function () { return this === undefined; })());
for (const [name, use, run, kind] of table) {
  const [[, honest], ...impostors] = values[kind];
  set[kind](honest());
  for (let i = 0; i < 300; i++) run(use, [], null);
  for (const [label, make] of impostors) {
    set[kind](honest());
    const results = [];
    const end = outcome(() => run(use, results, () => set[kind](make())));
    console.log(name + ": " + label + " -> " + show(results) + " " + end);
  }
}
