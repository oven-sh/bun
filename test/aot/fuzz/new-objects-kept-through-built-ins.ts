// Small functions that make an object, hand it to a built-in that keeps it somewhere, let other code change it through that place, and read it again themselves: whoever makes an object knows all about it only until somebody else can reach it, and a built-in is somebody else.
//
//   objects   a literal, a literal inside a literal, an instance of a class, a list, a Map, a closure with a field, an object without a prototype
//   kept by   descriptors (defineProperty, defineProperties, create, Reflect.defineProperty, getOwnPropertyDescriptors), copies of properties (assign, a spread, fromEntries, entries, values, groupBy),
//             prototypes (setPrototypeOf, create), collections and their constructors (Map, Set, WeakMap, WeakRef, Array.from, Array.of), methods of lists (concat, slice, flat, fill, with, sort, toSorted, splice, push by apply),
//             functions (bind, Reflect.apply, Reflect.construct), promises, JSON's reviver and replacer, a Proxy and its handler, an iterator, an error's cause, a getter in a descriptor, structuredClone, which keeps nothing
//   changed   by a function that is handed a closure over the place; straight on, behind a call by value, in a callback, in a job that runs behind an await
//   read      the field, the field twice with the change in between, in a loop, behind a test
//
// Each line names the road and prints what the maker read.
import type { Random } from "./random";

// `N` is the new object, `P` the place that other code reads it from: an expression over `holder` and `made`.
const roads: [string, string, string][] = [
  ["defineProperty", 'Object.defineProperty(holder, "k", { value: N, configurable: true });', "holder.k"],
  ["defineProperty with a descriptor out of a variable", 'const descriptor = flag ? { value: N, configurable: true } : { value: N, configurable: true, enumerable: true }; Object.defineProperty(holder, "k", descriptor);', "holder.k"],
  ["defineProperty under a symbol", 'Object.defineProperty(holder, Symbol.for("k"), { value: N, configurable: true });', 'holder[Symbol.for("k")]'],
  ["defineProperty with a getter", 'Object.defineProperty(holder, "k", { get() { return N; }, configurable: true });', "holder.k"],
  ["defineProperties", "Object.defineProperties(holder, { k: { value: N, configurable: true } });", "holder.k"],
  ["Reflect.defineProperty", 'Reflect.defineProperty(holder, "k", { value: N, configurable: true });', "holder.k"],
  ["Object.create with descriptors", "made = Object.create(null, { k: { value: N } });", "made.k"],
  ["Object.create as the prototype", "made = Object.create(N);", "Object.getPrototypeOf(made)"],
  ["getOwnPropertyDescriptors", "made = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ k: N }));", "made.k"],
  ["getOwnPropertyDescriptor", 'made = Object.getOwnPropertyDescriptor({ k: N }, "k");', "made.value"],
  ["Object.assign", "Object.assign(holder, { k: N });", "holder.k"],
  ["a spread of an object", "made = { ...{ k: N } };", "made.k"],
  ["Object.fromEntries", 'made = Object.fromEntries([["k", N]]);', "made.k"],
  ["Object.entries", "made = Object.entries({ k: N });", "made[0][1]"],
  ["Object.values", "made = Object.values({ k: N });", "made[0]"],
  ["Object.groupBy", 'made = Object.groupBy([N], () => "k");', "made.k[0]"],
  ["Map.groupBy", 'made = Map.groupBy([N], () => "k");', 'made.get("k")[0]'],
  ["Object.setPrototypeOf", "made = {}; Object.setPrototypeOf(made, N);", "Object.getPrototypeOf(made)"],
  ["Reflect.setPrototypeOf", "made = {}; Reflect.setPrototypeOf(made, N);", "Reflect.getPrototypeOf(made)"],
  ["Reflect.set", 'Reflect.set(holder, "k", N);', "holder.k"],
  ["new Map", 'made = new Map([["k", N]]);', 'made.get("k")'],
  ["a key of a Map", "made = new Map([[N, 1]]);", "[...made.keys()][0]"],
  ["Map.prototype.set by call", 'made = new Map(); Map.prototype.set.call(made, "k", N);', 'made.get("k")'],
  ["new Set", "made = new Set([N]);", "[...made][0]"],
  ["new WeakMap", "made = new WeakMap([[holder, N]]);", "made.get(holder)"],
  ["new WeakRef", "made = new WeakRef(N);", "made.deref()"],
  ["Array.from", "made = Array.from([N]);", "made[0]"],
  ["Array.from with a callback", "made = Array.from([0], () => N);", "made[0]"],
  ["Array.of", "made = Array.of(N);", "made[0]"],
  ["concat", "made = [].concat([N] as any);", "made[0]"],
  ["slice", "made = [N].slice();", "made[0]"],
  ["flat", "made = [[N]].flat();", "made[0]"],
  ["fill", "made = new Array(2).fill(N);", "made[1]"],
  ["with", "made = [0 as any].with(0, N);", "made[0]"],
  ["sort", "made = [N, other].sort(() => 0);", "made[0]"],
  ["toSorted", "made = [N, other].toSorted(() => 0);", "made[0]"],
  ["toReversed", "made = [other, N].toReversed();", "made[0]"],
  ["splice", "made = [N, other].splice(0, 1);", "made[0]"],
  ["push by apply", "made = []; Array.prototype.push.apply(made, [N]);", "made[0]"],
  ["map", "made = [0].map(() => N);", "made[0]"],
  ["filter", "made = [N].filter(() => true);", "made[0]"],
  ["reduce", "made = [[N].reduce((_, each) => each, other)];", "made[0]"],
  ["the list that a callback is handed", "[N].forEach((_, __, list) => { made = list; });", "made[0]"],
  ["bind as this", "made = function (this: any) { return this; }.bind(N);", "made()"],
  ["bind as an argument", "made = ((each: any) => each).bind(null, N);", "made()"],
  ["Reflect.apply", "made = Reflect.apply(function (each: any) { return [each]; }, null, [N]);", "made[0]"],
  ["Reflect.construct", "made = Reflect.construct(function (this: any, each: any) { this.k = each; }, [N]);", "made.k"],
  ["a reviver", "made = JSON.parse('{\"k\":1}', (key, value) => (key === \"k\" ? N : value));", "made.k"],
  ["a replacer", 'JSON.stringify({ k: N }, (key, value) => { if (key === "k") made = [value]; return 1; });', "made[0]"],
  ["toJSON", "made = []; JSON.stringify({ k: { toJSON() { made.push(N); return 1; } } });", "made[0]"],
  ["the target of a Proxy", "made = new Proxy(N, {});", "made"],
  ["the handler of a Proxy", "made = new Proxy({}, { get() { return N; } });", "made.k"],
  ["an iterator of a list", "made = [N].values();", "made.next().value"],
  ["Iterator.from", "made = Iterator.from([N]);", "made.next().value"],
  ["the cause of an error", 'made = new Error("", { cause: N });', "made.cause"],
  ["the errors of an AggregateError", "made = new AggregateError([N]);", "made.errors[0]"],
  ["a tagged template", "made = ((_: TemplateStringsArray, ...values: any[]) => values)`${N}`;", "made[0]"],
  ["structuredClone, which keeps nothing", "made = structuredClone([0]); holder.k = undefined;", "made[1]"],
];

const objects: [string, string, string][] = [
  ["{ a: seed }", "a", ""],
  ["{ a: seed, b: { a: seed } }", "a", ""],
  ["new Point(seed)", "a", "class Point { a: number; constructor(a: number) { this.a = a; } }"],
  ["Object.assign(Object.create(null), { a: seed })", "a", ""],
  ["Object.assign(() => seed, { a: seed })", "a", ""],
  ["[seed, seed]", "0", ""],
];

const changers = [
  "function change(read: () => any, name: string): void { const found = read(); if (found) found[name] = 99; }",
  "function change(read: () => any, name: string): void { [0].forEach(() => { const found = read(); if (found) found[name] = 99; }); }",
  "const changes = [(read: () => any, name: string): void => { const found = read(); if (found) found[name] = 99; }];\nfunction change(read: () => any, name: string): void { changes[0](read, name); }",
  "function change(read: () => any, name: string): void { const found = read(); if (found) Reflect.set(found, name, 99); }",
];

export function generate(random: Random): string {
  const lines = ["const holder: any = {};", "let made: any;", "const other: any = { a: -1, 0: -1 };", random.pick(changers)];
  const declared = new Set<string>();
  const chosen = random.shuffled(roads).slice(0, random.between(8, 20));
  chosen.forEach(([name, road, place], index) => {
    const [maker, field, declaration] = random.pick(objects);
    if (declaration && !declared.has(declaration)) {
      declared.add(declaration);
      lines.push(declaration);
    }
    const read = /^\d/.test(field) ? `fresh[${field}]` : `fresh.${field}`;
    lines.push(`function road${index}(seed: number, flag: boolean): string {`);
    lines.push(`  const fresh: any = ${maker};`);
    if (random.chance(0.5)) lines.push(`  const before = ${read};`);
    else lines.push(`  const before = "";`);
    lines.push(`  ${road.replaceAll(/\bN\b/g, "fresh")}`);
    lines.push(`  change(() => ${place}, ${JSON.stringify(field)});`);
    lines.push(random.pick([`  return before + " " + ${read};`, `  let sum = 0; for (let turn = 0; turn < 3; turn++) sum += ${read}; return before + " " + sum;`, `  return before + " " + (flag ? ${read} : ${read} + 1);`]));
    lines.push(`}`);
    lines.push(`{`);
    lines.push(`  let answer = "";`);
    lines.push(`  try { for (let turn = 0; turn < ${random.pick([1, 3, 300])}; turn++) answer = road${index}(turn, (turn & 1) === 0); } catch (error) { answer = "THROWS " + (error as Error).constructor.name; }`);
    lines.push(`  console.log(${JSON.stringify(name)} + ": " + answer);`);
    lines.push(`}`);
  });
  lines.push(`{`);
  lines.push(`  const fresh: any = { a: 5 };`);
  lines.push(`  ${random.pick(["Promise.resolve(fresh)", "Promise.all([fresh]).then(all => all[0])", "(async () => fresh)()", "new Promise(resolve => resolve(fresh))"])}.then((found: any) => { found.a = 77; });`);
  lines.push(`  const before = fresh.a;`);
  lines.push(`  await 0; await 0; await 0; await 0;`);
  lines.push(`  console.log("a promise: " + before + " " + fresh.a);`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
