// Small programs about one thing: a value reaches an object only because a built-in function took it out of one of its operands and put it into another, or into what it answers.
// The roads: a description (`value`, `get`, `set`) handed to Object.defineProperty, Reflect.defineProperty, Object.defineProperties or Object.create, written out, made elsewhere, inherited, read from another object;
// a copy of own properties (Object.assign, a spread, Object.fromEntries, Object.entries); a list method that takes elements from a list; a collection made from a list; a bound function.
// The value is a closure, an object, a list, a class, the built-in's own receiver (`Object`, `Reflect`), the operand that holds it, or the target itself.
// Then the value is used through its new holder and looked at under its old name, and the other way round.
import { Random } from "./random";

type Road = {
  name: string;
  /** Statements that leave `T` holding $V under $K; `S` is free to use. */
  text: string;
  /** How the value is read back; `T[$K]` where it is absent. */
  read?: string;
  /** The value arrives as a getter or a setter. */
  part?: "get" | "set";
  /** Keys that the road takes; every key where it is absent. */
  keys?: "names" | "indexes";
};

const descriptions: [string, string][] = [
  ["written out", "{ $P: $V, enumerable: true, configurable: true }"],
  ["kept in a constant", "description"],
  ["out of a function", "describe($V)"],
  ["nobody knows", "launder({ $P: $V, enumerable: true, configurable: true })"],
  ["inherited", "Object.create({ $P: $V, enumerable: true, configurable: true })"],
  ["inherited from a class", "new Description($V)"],
  [
    "either of two",
    "(turn % 2 ? { $P: $V, enumerable: true, configurable: true } : { $P: $V, enumerable: false, configurable: true })",
  ],
  ["filled later", "fill({}, $V)"],
  ["behind a getter", "{ get $P() { return $V; }, enumerable: true, configurable: true }"],
  ["without a prototype", "Object.assign(Object.create(null), { $P: $V, enumerable: true, configurable: true })"],
  ["a function with members", "Object.assign(function () {}, { $P: $V, enumerable: true, configurable: true })"],
  ["a list with members", "Object.assign([], { $P: $V, enumerable: true, configurable: true })"],
  ["read from another object", "Object.getOwnPropertyDescriptor($SOURCE, $K)"],
  ["read by Reflect", "Reflect.getOwnPropertyDescriptor($SOURCE, $K)"],
];

const takers: [string, string][] = [
  ["Object.defineProperty", "Object.defineProperty(T, $K, $D);"],
  ["Reflect.defineProperty", "Reflect.defineProperty(T, $K, $D);"],
  ["Object.defineProperties", "Object.defineProperties(T, { [$K]: $D });"],
  ["Object.defineProperties of a map nobody knows", "Object.defineProperties(T, launder({ [$K]: $D }));"],
  ["Object.defineProperties of a map made in steps", "S = {}; S[$K] = $D; Object.defineProperties(T, S);"],
  ["Object.create", "T = Object.create(null, { [$K]: $D });"],
  ["Object.create below an object", "T = Object.create({ below: 1 }, { [$K]: $D });"],
  ["taken off Object", "defineProperty(T, $K, $D);"],
  ["taken off Object, a map", "defineProperties(T, { [$K]: $D });"],
  ["through call", "Object.defineProperty.call(undefined, T, $K, $D);"],
  ["through apply", "Reflect.apply(Object.defineProperty, Object, [T, $K, $D]);"],
  ["a built-in nobody knows", "launder(Object.defineProperty)(T, $K, $D);"],
  ["a member under a key", 'Object["define" + "Property"](T, $K, $D);'],
];

const otherRoads: Road[] = [
  {
    name: "every description of another object",
    text: "Object.defineProperties(T, Object.getOwnPropertyDescriptors($SOURCE));",
  },
  {
    name: "Object.create with every description of another object",
    text: "T = Object.create(null, Object.getOwnPropertyDescriptors($SOURCE));",
  },
  {
    name: "every description, one deleted",
    text: "S = Object.getOwnPropertyDescriptors({ other: 1, ...$SOURCE }); delete S.other; Object.defineProperties(T, S);",
  },
  { name: "Object.assign", text: "Object.assign(T, $SOURCE);" },
  { name: "Object.assign of two", text: "Object.assign(T, { first: 1 }, $SOURCE);" },
  { name: "Object.assign of a getter", text: "Object.assign(T, { get [$K]() { return $V; } });" },
  { name: "Object.assign of what nobody knows", text: "Object.assign(T, launder($SOURCE));" },
  { name: "Object.assign onto what nobody knows", text: "T = launder(T); Object.assign(T, $SOURCE);" },
  { name: "a spread", text: "T = { ...$SOURCE };" },
  { name: "a spread behind a member", text: "T = { first: 1, ...$SOURCE };" },
  { name: "Object.fromEntries", text: "T = Object.fromEntries([[$K, $V]]);" },
  { name: "Object.fromEntries of Object.entries", text: "T = Object.fromEntries(Object.entries($SOURCE));" },
  { name: "Object.fromEntries of a Map", text: "T = Object.fromEntries(new Map([[$K, $V]]));" },
  { name: "Object.fromEntries of a generator", text: "T = Object.fromEntries((function* () { yield [$K, $V]; })());" },
  { name: "Reflect.set", text: "Reflect.set(T, $K, $V);" },
  { name: "Reflect.set for a receiver", text: "Reflect.set({}, $K, $V, T);" },
  { name: "__defineGetter__", text: "T.__defineGetter__($K, $V);", part: "get" },
  { name: "__defineSetter__", text: "T.__defineSetter__($K, $V);", part: "set" },
  { name: "Object.setPrototypeOf", text: "Object.setPrototypeOf(T, $SOURCE);" },
  { name: "Reflect.setPrototypeOf", text: "Reflect.setPrototypeOf(T, $SOURCE);" },
  { name: "Object.values", text: "T = Object.values($SOURCE);", read: "T[0]" },
  { name: "Object.entries", text: "T = Object.entries($SOURCE);", read: "T[0][1]" },
  { name: "push of a spread list", text: "T = []; T.push(...[$V]);", read: "T[0]" },
  { name: "push through apply", text: "T = []; Array.prototype.push.apply(T, [$V]);", read: "T[0]" },
  { name: "push onto an object", text: "Array.prototype.push.call(T, $V);", read: "T[0]" },
  { name: "concat", text: "T = [].concat([$V]);", read: "T[0]" },
  { name: "concat of the value", text: "T = [0].concat([[$V]]);", read: "T[1][0]" },
  { name: "splice", text: "T = [0, 1]; T.splice(1, 0, ...[$V]);", read: "T[1]" },
  { name: "what splice took out", text: "T = [0, $V, 1].splice(1, 1);", read: "T[0]" },
  { name: "fill", text: "T = [0, 1]; T.fill($V);", read: "T[1]" },
  { name: "fill of an object", text: "T.length = 2; Array.prototype.fill.call(T, $V);", read: "T[1]" },
  { name: "copyWithin", text: "T = [$V, 0, 0]; T.copyWithin(1, 0, 1);", read: "T[1]" },
  { name: "Array.from a list", text: "T = Array.from([$V]);", read: "T[0]" },
  { name: "Array.from an object with a length", text: "T = Array.from({ length: 1, 0: $V });", read: "T[0]" },
  { name: "Array.from a Set", text: "T = Array.from(new Set([$V]));", read: "T[0]" },
  { name: "Array.of", text: "T = Array.of($V);", read: "T[0]" },
  { name: "slice", text: "T = [0, $V].slice(1);", read: "T[0]" },
  { name: "flat", text: "T = [[$V]].flat();", read: "T[0]" },
  { name: "with", text: "T = [0].with(0, $V);", read: "T[0]" },
  { name: "toSpliced", text: "T = [0].toSpliced(0, 1, $V);", read: "T[0]" },
  { name: "toReversed", text: "T = [0, $V].toReversed();", read: "T[0]" },
  { name: "toSorted", text: "T = [$V].toSorted();", read: "T[0]" },
  { name: "reverse", text: "T = [0, $V]; T.reverse();", read: "T[0]" },
  { name: "unshift", text: "T = [0]; T.unshift($V);", read: "T[0]" },
  { name: "a Map from a list", text: "T = new Map([[$K, $V]]);", read: "T.get($K)" },
  { name: "a Map from a Map", text: "T = new Map(new Map([[$K, $V]]));", read: "T.get($K)" },
  { name: "a Set from a list", text: "T = new Set([$V]);", read: "[...T][0]" },
  { name: "the values of a Set", text: "T = new Set([$V]).values();", read: "(S ??= T.next().value)" },
  { name: "a WeakMap from a list", text: "T = new WeakMap([[anchor, $V]]);", read: "T.get(anchor)" },
  { name: "a WeakRef", text: "T = new WeakRef($V);", read: "T.deref()" },
  { name: "Object.groupBy", text: 'T = Object.groupBy([$V], () => "group");', read: "T.group[0]" },
  { name: "Map.groupBy", text: 'T = Map.groupBy([$V], () => "group");', read: 'T.get("group")[0]' },
  { name: "a bound receiver", text: "T = function () { return this; }.bind($V);", read: "T()" },
  { name: "a bound argument", text: "T = ((given) => given).bind(null, $V);", read: "T()" },
  { name: "Reflect.apply", text: "T = [Reflect.apply((given) => given, null, [$V])];", read: "T[0]" },
  {
    name: "Reflect.construct",
    text: "T = Reflect.construct(function (given) { this.held = given; }, [$V]);",
    read: "T.held",
  },
  { name: "an iterator's result", text: "T = [$V][Symbol.iterator]().next();", read: "T.value" },
  { name: "the entries of a list", text: "T = [$V].entries().next().value;", read: "T[1]" },
  { name: "Array.prototype.map with a built-in", text: "T = [$V].map(Object);", read: "T[0]" },
  { name: "Object()", text: "T = [Object($V)];", read: "T[0]" },
  { name: "a Proxy's target", text: "T = new Proxy($SOURCE, {});" },
  { name: "Reflect.get", text: "T = [Reflect.get($SOURCE, $K)];", read: "T[0]" },
  {
    name: "Reflect.ownKeys and a read",
    text: "S = $SOURCE; T = Reflect.ownKeys(S).map((key) => S[key]);",
    read: "T[0]",
  },
  { name: "an error's cause", text: 'T = new Error("text", { cause: $V });', read: "T.cause" },
  { name: "an AggregateError's errors", text: "T = new AggregateError([$V]);", read: "T.errors[0]" },
  {
    name: "JSON.parse with a reviver",
    text: 'T = JSON.parse(\'{"held":1}\', (key, given) => (key === "held" ? $V : given));',
    read: "T.held",
  },
  { name: "at", text: "T = [[$V].at(0)];", read: "T[0]" },
  { name: "find", text: "T = [[0, $V].find((each) => each !== 0)];", read: "T[0]" },
  { name: "findLast", text: "T = [[$V, 0].findLast((each) => each !== 0)];", read: "T[0]" },
  { name: "filter", text: "T = [0, $V].filter(Boolean);", read: "T[0]" },
  { name: "reduce", text: "T = [[0, $V].reduce((before, each) => each)];", read: "T[0]" },
  { name: "pop", text: "T = [[0, $V].pop()];", read: "T[0]" },
  { name: "shift", text: "T = [[$V, 0].shift()];", read: "T[0]" },
  { name: "Promise.resolve", text: "T = [await Promise.resolve($V)];", read: "T[0]" },
  { name: "Promise.all", text: "T = await Promise.all([$V]);", read: "T[0]" },
  { name: "Promise.allSettled", text: "T = await Promise.allSettled([$V]);", read: "T[0].value" },
  { name: "Promise.any", text: "T = [await Promise.any([$V])];", read: "T[0]" },
  { name: "Promise.race", text: "T = [await Promise.race([$V])];", read: "T[0]" },
  { name: "a rejection", text: "T = [await Promise.reject($V).catch((reason) => reason)];", read: "T[0]" },
  { name: "Array.fromAsync", text: "T = await Array.fromAsync([$V]);", read: "T[0]" },
  { name: "Iterator.from", text: "T = Iterator.from([$V]).toArray();", read: "T[0]" },
  { name: "an iterator helper", text: "T = [$V].values().map((each) => each).toArray();", read: "T[0]" },
];

type Held = {
  name: string;
  /** Declares `V`. */
  make: string;
  /** Lines in terms of $R, the value as its new holder has it, and V. Each prints. */
  uses: string[];
  isCallable?: true;
};

const held: Held[] = [
  {
    name: "a closure over a counter",
    make: "let count = 0; const V = function () { return ++count; };",
    isCallable: true,
    uses: [
      "print($R(), $R(), count);",
      "print($R === V, typeof $R);",
      "$R.mark = turn; print(V.mark);",
      "V.mark = turn + 1; print($R.mark);",
      "print($R.call(null), count, V());",
      "print(new $R() instanceof V);",
      'Object.defineProperty($R, "name", { value: "renamed" }); print(V.name);',
      "$R.prototype.method = () => turn; print(new V().method());",
    ],
  },
  {
    name: "an arrow nobody else calls",
    make: "const seen = []; const V = (given) => { seen.push(given); return seen.length; };",
    isCallable: true,
    uses: [
      "print($R(turn), seen.join());",
      "print($R(1), $R(2), seen.length);",
      "print($R.length, $R.name.length >= 0);",
    ],
  },
  {
    name: "an object with a number",
    make: "const V = { n: 1, m: 2 };",
    uses: [
      "$R.n = 5; print(V.n);",
      "V.n = 6; print($R.n);",
      '$R.n = "text"; print(typeof V.n, V.n);',
      "$R.n = 0.5; print(V.n + V.m);",
      "$R.added = turn; print(V.added, Object.keys(V).join());",
      'delete $R.n; print(V.n, "n" in V, Object.keys(V).join());',
      "Object.freeze($R); print(Object.isFrozen(V)); try { V.n = 9; } catch (error) { print(error.constructor.name); } print(V.n);",
      'Object.defineProperty($R, "n", { get() { return 40 + turn; } }); print(V.n);',
      "Object.setPrototypeOf($R, { inherited: turn }); print(V.inherited);",
      "print($R === V, $R.n + $R.m);",
      "$R.n++; $R.n++; print(V.n);",
      "$R.m = undefined; print(V.m, V.n);",
      "$R.m = { deep: turn }; print(V.m.deep);",
    ],
  },
  {
    name: "an object made in a function",
    make: "const make = (n) => ({ n, list: [n] }); const V = make(3);",
    uses: [
      "$R.list.push(4); print(V.list.join());",
      "$R.n = null; print(V.n);",
      "V.list.length = 0; print($R.list.length);",
      "$R.list = 7; print(V.list);",
    ],
  },
  {
    name: "a list of numbers",
    make: "const V = [1, 2, 3];",
    uses: [
      "$R.push(4); print(V.length, V.join());",
      '$R[0] = "text"; print(typeof V[0]);',
      "$R[1] = 0.5; print(V[0] + V[1]);",
      "$R.length = 1; print(V.join(), V[2]);",
      "$R[5] = 9; print(V.length, 4 in V);",
      "V.pop(); print($R.length);",
      "$R[0] = { deep: 1 }; print(V[0].deep);",
      "$R.named = turn; print(V.named);",
      "delete $R[1]; print(1 in V, V.join());",
      "Object.freeze($R); try { V.push(1); } catch (error) { print(error.constructor.name); } print(V.length);",
    ],
  },
  {
    name: "a class",
    make: "class V { static made = 0; field = 1; constructor() { V.made++; } method() { return this.field; } }",
    isCallable: true,
    uses: [
      "print(new $R().method(), V.made);",
      "$R.made = 10; print(V.made);",
      "$R.prototype.method = function () { return 7; }; print(new V().method());",
      "print(new $R() instanceof V, $R.name);",
      "class Below extends $R {} print(new Below().field, V.made);",
    ],
  },
  {
    name: "an instance of a class",
    make: "class Point { x = 1; y = 2; sum() { return this.x + this.y; } } const V = new Point();",
    uses: [
      "$R.x = 10; print(V.sum());",
      '$R.x = "a"; print(V.sum());',
      "$R.sum = () => turn; print(V.sum());",
      "delete $R.y; print(V.sum());",
      "Object.setPrototypeOf($R, null); print(typeof V.sum);",
      "$R.z = 1; print(Object.keys(V).join());",
    ],
  },
  {
    name: "a Map",
    make: "const V = new Map([[1, 1]]);",
    uses: ["$R.set(2, 2); print(V.size);", "$R.clear(); print(V.size, V.get(1));", "$R.extra = turn; print(V.extra);"],
  },
  {
    name: "a typed array",
    make: "const V = new Int32Array([1, 2, 3]);",
    uses: ["$R[0] = 9; print(V[0]);", "$R.fill(7); print(V.join());", "V[1] = 5; print($R[1]);"],
  },
  {
    name: "a boxed closure",
    make: "let hidden = 1; const V = { read: () => hidden, write: (given) => { hidden = given; } };",
    uses: [
      "$R.write(turn + 5); print(hidden, V.read());",
      "$R.read = () => -1; print(V.read());",
      "hidden = 3; print($R.read());",
    ],
  },
];

/** Values that are operands of the very call, or stand in it where nobody looks. */
const inTheCall: [string, string][] = [
  ["the function's own holder", "Object"],
  ["Reflect", "Reflect"],
  ["the function itself", "Object.defineProperty"],
  ["Object.prototype", "Object.prototype"],
  ["the global object", "globalThis"],
];

const names = [
  '"held"',
  '"constructor"',
  '"value"',
  '"get"',
  '"toString"',
  '"length"',
  '"__proto__"',
  '"then"',
  "symbol",
  "Symbol.iterator",
  '"0"',
  "0",
  '"a b"',
];

const head = `const lines = [];
const print = (...given) => lines.push(given.map((each) => (typeof each === "symbol" ? each.toString() : String(each))).join(" "));
const launder = new Function("value", process.argv[9] ?? "return value");
const symbol = Symbol("key");
const anchor = {};
const { defineProperty, defineProperties } = Object;
`;

function roadsThroughDescriptions(random: Random, part: "value" | "get" | "set"): Road {
  const [describedAs, description] = random.pick(descriptions);
  const [takenBy, taker] = random.pick(takers);
  return {
    name: `${takenBy}, a description ${describedAs}, ${part}`,
    text: taker.replaceAll("$D", description.replaceAll("$P", part)),
    part: part === "value" ? undefined : part,
  };
}

export function generate(random: Random): string {
  const value = random.pick(held);
  const part = value.isCallable && random.chance(0.35) ? random.pick(["get", "set"] as const) : "value";
  let road = random.chance(0.55) ? roadsThroughDescriptions(random, part) : random.pick(otherRoads);
  if (road.part && !value.isCallable) road = roadsThroughDescriptions(random, "value");
  const key = random.chance(0.5) ? '"held"' : random.pick(names);
  const isInFunction = random.chance(0.5);
  const turns = random.pick([1, 1, 2, 3]);
  const source =
    road.part === "get"
      ? `{ get [${key}]() { return V(); } }`
      : road.part === "set"
        ? `{ set [${key}](given) { V(given); } }`
        : `{ [${key}]: V }`;
  const fill = (text: string) => text.replaceAll("$SOURCE", source).replaceAll("$K", key).replaceAll("$V", "V");

  const read = fill(road.read ?? "T[$K]");
  const uses = random.sample(value.uses, random.between(1, 3));
  const used = road.part
    ? road.part === "get"
      ? [`print(typeof ${read}, String(${read}).length > 0);`, `print(${read} === ${read});`]
      : [`${read} = turn; print("stored");`, `${read} = { given: turn }; print("stored again");`]
    : uses.map(use => use.replaceAll("$R", `(${read})`).replace(/^\((.*?)\)(\.[a-z]+|\[\d\]) = /, "$1$2 = "));
  const after = value.name.startsWith("a closure")
    ? "print(count);"
    : value.name.startsWith("an arrow")
      ? "print(seen.length);"
      : "";

  const body = `${value.make}
const description = { ${part}: V, enumerable: true, configurable: true };
const describe = (given) => ({ ${part}: given, enumerable: true, configurable: true });
const fill = (empty, given) => { empty.${part} = given; empty.enumerable = true; empty.configurable = true; return empty; };
class Inherited { get ${part}() { return this.given; } get enumerable() { return true; } get configurable() { return true; } }
class Description extends Inherited { constructor(given) { super(); this.given = given; } }
let T = {};
let S;
try {
  ${fill(road.text)}
  ${used.join("\n  ")}
  ${after}
} catch (error) {
  print("threw", error.constructor.name);
}`;

  const indented = body.replaceAll("\n", "\n  ");
  const scene = isInFunction
    ? `async function scene(turn) {\n  ${indented}\n}\nfor (let turn = 0; turn < ${turns}; turn++) await scene(turn);`
    : `const turn = 0;\n${body}`;
  return `// ${value.name} . ${road.name} . ${key}\n${head}${scene}\nconsole.log(lines.join("\\n"));\n`;
}

/** The value is an operand of the very call that carries it, or stands in the call where the function does not look. */
export function generateWithOperandsThatHoldEachOther(random: Random): string {
  const [what, value] = random.pick([
    ...inTheCall,
    ["the description itself", "D"],
    ["the map itself", "M"],
    ["the target itself", "T"],
    ["an argument too many", "extra"],
  ] as [string, string][]);
  const key = random.pick(names);
  const part = random.pick(["value", "value", "get", "set"]);
  const isCallable = ["Object", "Object.defineProperty", "extra"].includes(value);
  const member = isCallable ? part : "value";
  const calls = [
    "Object.defineProperty(T, $K, D);",
    "Object.defineProperty(T, $K, D, extra);",
    "Reflect.defineProperty(T, $K, D);",
    "Reflect.defineProperty(T, $K, D, extra);",
    "Object.defineProperties(T, M);",
    "Object.defineProperties(T, M, extra);",
    "Object.defineProperties(T, Object.getOwnPropertyDescriptors({ [$K]: $V }));",
    "Object.defineProperty.call($V, T, $K, D);",
    "Object.defineProperties.call($V, T, M);",
    "Reflect.defineProperty.call($V, T, $K, D);",
    "Object.assign(T, { [$K]: $V });",
    "Object.assign(T, { [$K]: $V }, extra);",
    "Object.assign.call($V, T, { [$K]: $V });",
    "Reflect.set(T, $K, $V);",
    "Reflect.set.call($V, T, $K, $V);",
    "Reflect.set({}, $K, $V, T);",
    "launder(Object.defineProperty)(T, $K, D);",
    "launder(Object.defineProperties)(T, M);",
    "defineProperty(T, $K, D);",
    "defineProperties(T, M);",
    "Object.setPrototypeOf(T, $V === T ? null : $V);",
    "L.push.call(L, $V); T[$K] = L[0];",
    "L.push($V, 0); L.reverse($V); T[$K] = L[1];",
    "L.push(0, $V); L.reverse($V); T[$K] = L[0];",
    "L.push(0, $V); L.copyWithin(0, 1, 2, $V); T[$K] = L[0];",
    "L.push(0, $V); L.sort(undefined, $V); T[$K] = L.find((each) => each !== 0);",
    "L.push(0, $V); L.shift($V); T[$K] = L[0];",
    "L.push(0, 0, $V); L.splice(0, 1); L.splice(0, 1, ...[]); T[$K] = L[0];",
    "L.push($V); L.unshift(0); T[$K] = L[1];",
    "L.push($V); L.fill(L[0], 0, 1, $V); T[$K] = L[0];",
  ];
  const call = random.pick(calls).replaceAll("$K", key).replaceAll("$V", value);
  return `// ${what} . ${call}
${head}const extra = function () { return 1; };
const T = {};
const L = [];
const D = { enumerable: true, configurable: true };
const M = { [${key}]: D };
D.${member} = ${value};
try {
  ${call}
  const found = Object.getOwnPropertyDescriptor(T, ${key}) ?? {};
  print(found.value === ${value}, found.get === ${value}, found.set === ${value}, Object.getPrototypeOf(T) === ${value});
  print(Reflect.ownKeys(T).length, L.length);
} catch (error) {
  print("threw", error.constructor.name);
}
console.log(lines.join("\\n"));
`;
}
