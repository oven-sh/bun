// One name that holds many kinds of things in the course of a program: something that can be called, a record without a class of its own, and a thing with a fast form, such as a list or a Map.
// A use of the name is compiled for all of them at once: a test for one kind must not forget what the others are.
//
//   called    a bound function, an arrow, a function, a class, a bound built-in, an async function, a generator function, a proxy
//   record    out of Object.groupBy, Object.create(null), Object.fromEntries, JSON.parse, a literal with numbers as keys, a literal without a prototype, an arguments object
//   fast      lists of whole numbers, fractions, strings, objects, a filled `new Array`, typed arrays, a Map, a Set, a pattern, a promise, a string, a boxed string, a date; null, undefined, a number
//   name      a variable of the module, one of a function that closures share, a field, a static member, an element
//   use       by element, by name, by call, `new`, `for-of`, a spread, patterns, a store, a delete, `in`, tests of the kind, methods that only some have
//   where     right there, in a closure that is handed on, in a function that gets the value, in a method, in a generator
//   when      each thing is used as soon as the name holds it, or only the first is, and the others come behind
import type { Random } from "./random";

const prelude = `function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + Array.from(value, each => show(each, depth + 1)).join() + "]";
  if (value instanceof Map) return "Map(" + [...value].map(each => show(each, depth + 1)).join() + ")";
  if (value instanceof Set) return "Set(" + [...value].map(each => show(each, depth + 1)).join() + ")";
  if (ArrayBuffer.isView(value)) return Object.prototype.toString.call(value) + Array.prototype.join.call(value);
  if (value instanceof RegExp || value instanceof Date || value instanceof Error || value instanceof Promise || value instanceof String) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ":" + show((value as Record<string, unknown>)[key], depth + 1)).join() + "}";
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "THROWS " + (error as Error).constructor.name;
  }
}
function handed(read: () => any, name: string): unknown {
  const found = read();
  if (found && typeof found === "object") found[name] = 99;
  return found;
}
`;

const called = [`function (this: any) { return this; }.bind({ a: 1 })`, `() => 1`, `function named() { return [1, 2]; }`, `class Made { a = 1; }`, `async () => 3`, `new Proxy({ 1: "p" }, {})`, `Math.max.bind(null, 5)`, `function* () { yield 1; }`];
const records = [`Object.groupBy([1, 2], () => "k")`, `Object.create(null)`, `Object.fromEntries([["1", 5], ["length", 2]])`, `JSON.parse('{"1": 7, "size": 2, "a": 3}')`, `{ 0: "zero", 1: "one", length: 2 }`, `{ __proto__: null, 1: 4 }`, `(function (..._: number[]) { return arguments; })(1, 2, 3)`, `Object.assign(Object.create(null), { 1: { a: 3 } })`, `{ a: seed }`, `Object.create({ 1: "above", a: "above" })`]; // prettier-ignore
const fast = [`new Array(2).fill(fresh)`, `[1, 2, seed]`, `[0.5, 1.5, seed]`, `["a", "b"]`, `[fresh, fresh]`, `[]`, `new Array(3)`, `new Uint8Array([1, 2, 3])`, `new Float64Array([0.5, seed])`, `new Map<number, unknown>([[1, fresh]])`, `new Set([1, seed])`, `/a(b)/g`, `Promise.resolve(1)`, `"text"`, `new String("boxed")`, `new Date(0)`, `null`, `undefined`, `seed`, `seed + 0.5`]; // prettier-ignore

const uses = [
  `V[1]`,
  `V[index]`,
  `V[1].a`,
  `V?.[1]?.a`,
  `V.length`,
  `V.size`,
  `V.a`,
  `V(1, 2)`,
  `new V()`,
  `V.get(1)`,
  `V.has?.(1)`,
  `V.at?.(-1)`,
  `V.map((each: any) => each)`,
  `V.push?.(4)`,
  `V.exec?.("ab")`,
  `typeof V.then`,
  `[...V]`,
  `{ ...V }`,
  `(() => { let text = ""; for (const each of V) text += show(each); return text; })()`,
  `(() => { const [first, second] = V; return [second, first]; })()`,
  `(() => { const { length, a } = V; return [length, a]; })()`,
  `((V[1] = 9), V[1])`,
  `((V[index] = fresh), V[index] === fresh)`,
  `((V.a = 7), V.a)`,
  `delete V[1]`,
  `1 in V`,
  `"a" in V`,
  `V instanceof Array`,
  `Array.isArray(V) ? V.length : typeof V`,
  `typeof V === "function" ? V.length : V`,
  `V instanceof Map ? V.size : V instanceof Set ? V.has(1) : "neither"`,
  `Object.keys(V)`,
  `V == null ? "nothing" : V.constructor === Array`,
  `Reflect.ownKeys(V).length`,
  `handed(() => V[1], "a")`,
  `handed(() => V, "a")`,
  `Math.max(...V)`,
  `Array.from(V)`,
  `JSON.stringify(V)`,
];

function oneCase(random: Random, k: number): string {
  const things = [random.pick(called), random.pick(records), random.pick(fast)];
  for (let more = random.below(3); more > 0; more--) things.push(random.pick(random.pick([called, records, fast, fast])));
  // The thing with the fast form comes first more often than not: it is the one that is used while the others only stand in the text.
  const order = random.chance(0.6) ? [things[2], ...things.filter((_, index) => index !== 2)] : things.map((_, index) => things[(index + random.below(things.length)) % things.length]);
  const name = random.pick(["module", "shared", "field", "static", "element"] as const);
  const V = { module: `made${k}`, shared: `made${k}`, field: `box${k}.v`, static: `Box${k}.v`, element: `slots${k}[0]` }[name];
  const declared = { module: `let made${k}: any;`, shared: ``, field: `const box${k}: { v: any } = { v: undefined };`, static: `class Box${k} {\n  static v: any;\n}`, element: `const slots${k}: any[] = [undefined];` }[name];
  const mine = Array.from({ length: random.between(1, 4) }, () => random.pick(uses));
  const where = random.pick(["there", "closure", "given", "method", "generator"] as const);
  const asked = (use: string) => {
    const text = `(${use.replaceAll("V", where === "given" ? "value" : V)})`;
    switch (where) {
      case "there":
        return `attempt(() => ${text})`;
      case "closure":
        return `attempt(() => handed(() => ${text}, "a"))`;
      case "given":
        return `attempt(() => ((value: any) => ${text})(${V}))`;
      case "method":
        return `attempt(() => ({ ask() { return ${text}; } }).ask())`;
      default:
        return `attempt(() => [...(function* () { yield ${text}; })()][0])`;
    }
  };
  const ask = `[${mine.map(asked).join(", ")}].join(" | ")`;
  const turns = random.pick([1, 3, 300, 4000]);
  const onlyTheFirst = random.chance(0.5);
  const roads = order.map((thing, index) => `function road${k}_${index}(seed: number, index: number): string {\n  const fresh: any = { a: seed };\n  ${V} = ${thing};\n  return ${onlyTheFirst && index ? `"stored"` : ask};\n}`);
  const runs = order.map((_, index) => `{\n  let answer = "";\n  for (let turn = 0; turn < ${index ? 3 : turns}; turn++) answer = road${k}_${index}(turn, turn & 1);\n  console.log("${k} ${index} " + answer);\n}`);
  const body = [...roads, ...runs].join("\n");
  return name === "shared" ? `(() => {\nlet made${k}: any;\n${body}\n})();` : `${declared}\n${body}`;
}

export function generate(random: Random): string {
  return prelude + Array.from({ length: random.between(1, 4) }, (_, k) => oneCase(random, k)).join("\n") + "\n";
}
