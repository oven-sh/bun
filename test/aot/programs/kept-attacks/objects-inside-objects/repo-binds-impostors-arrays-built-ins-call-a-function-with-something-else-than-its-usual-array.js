// Objects inside objects: repo binds impostors arrays built ins call a function with something else than its usual array. It prints what plain Bun prints.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function walked(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen.join("/");
}

function pushed(list) {
  return list.push(9);
}

function doubled(list) {
  return list.map(value => value * 2);
}

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const makers = {
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "a subclass": () => Loud.of(3, 1, 2),
  "a string": () => "312",
  "a typed array": () => new Uint8Array([3, 1, 200]),
  "a Set": () => new Set([3, 1, 2]),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "null": () => null,
  "an array": () => [3, 1, 2],
};

const functions = { total, walked, pushed, doubled };

const routes = {
  "a plain call": (use, value) => use(value),
  "call": (use, value) => use.call(undefined, value),
  "apply": (use, value) => use.apply(undefined, [value]),
  "bind": (use, value) => use.bind(undefined, value)(),
  "bind without arguments": (use, value) => use.bind(undefined)(value),
  "Reflect.apply": (use, value) => Reflect.apply(use, undefined, [value]),
  "forEach": (use, value) => { let answer; [value].forEach(element => { answer = use(element); }); return answer; },
  "forEach with the function itself": (use, value) => { const answers = []; const keep = use; [value].forEach(function (element) { answers.push(keep(element)); }); return answers[0]; },
  "map with the function itself": (use, value) => [value].map(use)[0],
  "Array.from": (use, value) => Array.from([value], use)[0],
  "find": (use, value) => { let answer; [value].find(element => { answer = use(element); return true; }); return answer; },
  "a sort comparator": (use, value) => { let answer; [value, value].sort((a, b) => { answer = use(a); return 0; }); return answer; },
  "a replace callback": (use, value) => { let answer; "x".replace("x", () => { answer = use(value); return ""; }); return answer; },
  "Map.forEach": (use, value) => { let answer; new Map([["key", value]]).forEach(element => { answer = use(element); }); return answer; },
  "Set.forEach": (use, value) => { let answer; new Set([value]).forEach(element => { answer = use(element); }); return answer; },
  "a getter": (use, value) => use({ get list() { return value; } }.list),
  "a proxy's get trap": (use, value) => use(new Proxy({}, { get: () => value }).list),
  "a caught exception": (use, value) => { try { throw value; } catch (list) { return use(list); } },
  "a generator's next": (use, value) => { const steps = (function* () { return use(yield); })(); steps.next(); return steps.next(value).value; },
  "a yielded value": (use, value) => use((function* () { yield value; })().next().value),
  "a spread argument": (use, value) => use(...[value]),
  "a default parameter": (use, value) => ((list = value) => use(list))(),
  "Object.values": (use, value) => use(Object.values({ list: value })[0]),
  "an optional call": (use, value) => use?.(value),
  "a comma expression": (use, value) => (0, use)(value),
  "toJSON": (use, value) => { let answer; JSON.stringify({ toJSON() { answer = use(value); } }); return answer; },
  "a tagged template": (use, value) => ((strings, list) => use(list))`${value}`,
};

for (const name in functions) for (let i = 0; i < 2000; i++) functions[name]([3, 1, 2]);

for (const route in routes) {
  for (const maker in makers) {
    const answers = [];
    for (const name in functions) {
      try {
        answers.push(name + " " + describe(routes[route](functions[name], makers[maker]())));
      } catch (error) {
        answers.push(name + " threw " + error.constructor.name);
      }
    }
    console.log(route + ", " + maker + ": " + answers.join("; "));
  }
}
