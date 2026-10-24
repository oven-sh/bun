// An object that one thing alone holds, a collection, and weak references that tell whether the collector saw that one thing.
//
//   objects   the kinds of when-the-heap-is-full.ts that are objects; and objects inside objects, of which the outer or the inner one alone is held
//   held by   a variable, a variable in a loop, a parameter, `this`, a rest parameter, the arguments object, a value being thrown or returned through a finally, a closure, a generator, an async function, a timer, a promise, a handler,
//             an earlier element, argument or operand while a later one is evaluated, a receiver, a field, a private field, a static field, a late property, an element, a map, a set, the value of a weak map, a bound function, a proxy,
//             the cause of an error, the parameter of a callback, a loop over an iterator, a pattern, a spread, a variable of the module
//   told by   a WeakRef, a WeakSet, a WeakMap and a FinalizationRegistry that know the object from an earlier turn of the event loop, so that nothing of theirs keeps it alive
//   collected by Bun.gc, once or twice, full or young, behind garbage or not
//
// A collector may keep what nobody holds, so nothing is said about what was let go, but that its finalizer runs at most once, never after unregister and never in the middle of a job. What is held must be there:
// the WeakRef answers with it, the WeakSet has it, the WeakMap knows its number, its finalizer has not run, and it is whole.
import type { Random } from "./random";
import { beside, kinds } from "./when-the-heap-is-full";
import { prelude } from "./work-on-the-way-up";

const watching = `declare const Bun: { gc(full: boolean): unknown };
const lost = new Set<string>();
const early = new Set<string>();
type Seen = { ref: WeakRef<object>; token: number; handle: object };
const finalized = new Map<number, number>();
const unregistered = new Set<number>();
let insideACollection = 0;
let tokens = 0;
const registry = new FinalizationRegistry<number>(token => {
  if (insideACollection) early.add("a finalizer ran in the middle of a job");
  finalized.set(token, (finalized.get(token) ?? 0) + 1);
  const made = [new Point(token, 1), { token }];
  if ((made[0] as Point).sum !== token + 1) wrong.add("in a finalizer");
});
const marks = new WeakSet<object>();
const numbers = new WeakMap<object, number>();
function watch(x: object): Seen {
  const token = ++tokens;
  const handle = {};
  registry.register(x, token, handle);
  marks.add(x);
  numbers.set(x, token);
  return { ref: new WeakRef(x), token, handle };
}
function verify(where: string, seen: Seen, x: object): void {
  const now = seen.ref.deref();
  if (now === undefined) lost.add(where + ": the WeakRef is empty");
  else if (now !== x) wrong.add(where + ": the WeakRef has another object");
  if (!marks.has(x)) lost.add(where + ": the WeakSet");
  if (numbers.get(x) !== seen.token) lost.add(where + ": the WeakMap");
  if (finalized.has(seen.token)) early.add(where + ": finalized while held");
}
function turn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
function take<T>(box: { held: T | null }): T {
  const x = box.held!;
  box.held = null;
  return x;
}
function collected(): null {
  collect();
  return null;
}
function first<T>(x: T, _other: unknown): T {
  return x;
}
function tag<T>(_texts: TemplateStringsArray, x: T, _other: unknown): T {
  return x;
}
function* once<T>(x: T): Generator<T, void, unknown> {
  yield x;
}
class Wrapper<T> {
  #hidden: T;
  static last: unknown = null;
  constructor(
    public x: T,
    _other?: unknown,
  ) {
    this.#hidden = x;
  }
  with(_other: unknown): T {
    return this.x;
  }
  get hidden(): T {
    return this.#hidden;
  }
}
const kept: [object, Seen][] = [];
`;

// The body of a function that gets `box` and `i` and answers with the object. `T` stands for its type.
type Holder = readonly [name: string, body: string, isAsync?: true, beside?: string];
const holders: readonly Holder[] = [
  ["a-variable", `const x = take(box);\n  collect();\n  return x;`],
  ["a-variable-in-a-loop", `let x = take(box);\n  for (let n = 0; n < 3; n++) {\n    const y = x;\n    collect();\n    x = y;\n  }\n  return x;`],
  ["a-variable-behind-a-join", `let x: T;\n  if (i & 1) x = take(box);\n  else {\n    collect();\n    x = take(box);\n  }\n  collect();\n  return x;`],
  ["a-parameter", `return innerID(take(box));`, undefined, `function innerID(x: T): T {\n  collect();\n  return x;\n}`],
  ["a-parameter-many-frames-down", `return deepID(take(box), 40);`, undefined, `function deepID(x: T, depth: number): T {\n  if (depth > 0) return deepID(x, depth - 1);\n  collect();\n  return x;\n}`],
  ["this", `return function (this: T): T {\n    collect();\n    return this;\n  }.call(take(box));`],
  ["a-rest-parameter", `return ((...rest: Array<T>) => {\n    collect();\n    return rest[0];\n  })(take(box));`],
  ["the-arguments-object", `return (function (_x: T): T {\n    collect();\n    return arguments[0];\n  })(take(box));`],
  ["thrown-through-a-finally", `try {\n    try {\n      throw take(box);\n    } finally {\n      collect();\n    }\n  } catch (error) {\n    return error as T;\n  }`],
  ["returned-through-a-finally", `try {\n    return take(box);\n  } finally {\n    collect();\n  }`],
  ["a-closure", `const get = ((x: T) => () => x)(take(box));\n  collect();\n  return get();`],
  ["a-generator", `const generator = keepsID(take(box));\n  generator.next();\n  collect();\n  return generator.next().value as T;`, undefined, `function* keepsID(x: T): Generator<undefined, T, unknown> {\n  yield undefined;\n  return x;\n}`],
  ["an-async-function", `return laterID(take(box));`, true, `async function laterID(x: T): Promise<T> {\n  await turn();\n  collect();\n  await null;\n  collect();\n  return x;\n}`],
  ["an-async-generator", `const generator = streamsID(take(box));\n  await generator.next();\n  await turn();\n  collect();\n  return (await generator.next()).value as T;`, true, `async function* streamsID(x: T): AsyncGenerator<undefined, T, unknown> {\n  yield undefined;\n  await null;\n  return x;\n}`],
  ["a-timer", `return new Promise<T>(resolve => {\n    const x = take(box);\n    setTimeout(() => {\n      collect();\n      resolve(x);\n    }, 1);\n  });`, true],
  ["a-promise", `const promise = Promise.resolve(take(box));\n  await turn();\n  collect();\n  return promise;`, true],
  ["a-handler", `return Promise.resolve(take(box)).then(x => {\n    collect();\n    return x;\n  });`, true],
  ["a-promise-among-others", `return (await Promise.all([take(box), turn().then(collect)]))[0];`, true],
  ["an-earlier-element", `return [take(box), collected() as unknown as T][0];`],
  ["an-earlier-property", `return { x: take(box), y: collected() }.x;`],
  ["an-earlier-argument", `return first(take(box), collected());`],
  ["an-earlier-argument-of-new", `return new Wrapper(take(box), collected()).x;`],
  ["a-tagged-template", `return tag\`\${take(box)}\${collected()}\`;`],
  ["a-receiver", `return new Wrapper(take(box)).with(collected());`],
  ["a-field", `const holder = { x: take(box) };\n  collect();\n  return holder.x;`],
  ["a-field-of-an-instance", `const holder = new Wrapper(take(box));\n  collect();\n  return holder.x;`],
  ["a-private-field", `const holder = new Wrapper(take(box));\n  holder.x = null as unknown as T;\n  collect();\n  return holder.hidden;`],
  ["a-static-field", `Wrapper.last = take(box);\n  collect();\n  const x = Wrapper.last as T;\n  Wrapper.last = null;\n  return x;`],
  ["a-late-property", `const holder: Record<string, unknown> = {};\n  for (const key of keys) holder[key] = 0;\n  holder.late = take(box);\n  collect();\n  return holder.late as T;`],
  ["an-element", `const list: Array<T> = [take(box)];\n  collect();\n  return list[0];`],
  ["an-element-among-others", `const list: unknown[] = [1, "a", take(box), 0.5];\n  collect();\n  return list[2] as T;`],
  ["an-element-pushed-late", `const list: Array<T> = [];\n  const x = take(box);\n  for (let n = 0; n < 9; n++) list.push(x);\n  collect();\n  return list[8];`],
  ["a-value-of-a-map", `const map = new Map<number, T>([[1, take(box)]]);\n  collect();\n  return map.get(1)!;`],
  ["a-key-of-a-map", `const map = new Map<T, number>([[take(box), 1]]);\n  collect();\n  return [...map.keys()][0];`],
  ["a-member-of-a-set", `const set = new Set<T>([take(box)]);\n  collect();\n  return [...set][0];`],
  ["a-value-of-a-weak-map", `const key = {};\n  const weak = new WeakMap<object, T>();\n  weak.set(key, take(box));\n  collect();\n  return weak.get(key)!;`],
  ["a-bound-function", `const bound = (first as (x: T, other: unknown) => T).bind(null, take(box), 0);\n  collect();\n  return bound();`],
  ["a-proxy", `const proxy = new Proxy({ x: take(box) }, {});\n  collect();\n  return proxy.x;`],
  ["the-cause-of-an-error", `const error = new Error("e", { cause: take(box) });\n  collect();\n  return error.cause as T;`],
  ["the-parameter-of-a-callback", `return [take(box)].map(x => {\n    collect();\n    return x;\n  })[0];`],
  ["a-loop-over-an-array", `for (const x of [take(box)]) {\n    collect();\n    return x;\n  }\n  throw new Error("empty");`],
  ["a-loop-over-a-generator", `for (const x of once(take(box))) {\n    collect();\n    return x;\n  }\n  throw new Error("empty");`],
  ["a-pattern", `const { x } = { x: take(box) };\n  const [y] = [x];\n  collect();\n  return y;`],
  ["a-spread", `const copy = { ...{ x: take(box) } };\n  collect();\n  return [...[copy.x]][0];`],
  ["a-variable-of-the-module", `moduleID = take(box);\n  collect();\n  const x = moduleID!;\n  moduleID = null;\n  return x;`, undefined, `let moduleID: T | null = null;`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude, beside, watching];
  const churn = pick(["", "", `let garbage: unknown[] = [];\n  for (let n = 0; n < 20000; n++) garbage.push({ n }, [n]);\n  garbage = [];\n  `]);
  text.push(`function collect(): void {\n  insideACollection++;\n  ${churn}${pick(["Bun.gc(true);", "Bun.gc(true);", "Bun.gc(true);\n  Bun.gc(true);", "Bun.gc(false);\n  Bun.gc(true);", "Bun.gc(false);"])}\n  insideACollection--;\n}`);
  const objects = kinds.filter(([name, , , holds]) => !holds.includes("await") && !["texts", "numbers-with-a-fraction", "big-integers", "symbols"].includes(name));
  const names: string[] = [];
  const cases = random.between(4, 10);
  for (let id = 1; id <= cases; id++) {
    const [holderName, body, isAsync, more] = pick(holders);
    const inner = random.chance(0.25) ? pick(["the-inner-one-alone", "the-outer-one-alone"] as const) : undefined;
    const [kindName, type, make, holds] = inner ? (["objects-inside-objects", "Outer", "", ""] as const) : pick(objects);
    const name = `${kindName}${inner ? "--" + inner : ""}--${holderName}`;
    names.push(name);
    const held = inner === "the-inner-one-alone" ? pick(["{ i: number }", "number[]", "Point"]) : type;
    const written = (template: string) => template.replaceAll("ID", String(id)).replace(/\bT\b/g, `(${held})`);
    text.push(`// ${id}: ${name}`);
    if (more) text.push(written(more));
    text.push(`${isAsync ? "async " : ""}function use${id}(box: { held: (${held}) | null }, i: number): ${isAsync ? `Promise<${held}>` : `(${held})`} {\n  ${written(body)}\n}`);
    const rounds = pick([1, 3, 10]);
    const ending = `if (i % 3 === 0) kept.push([x, seen]);
  else if (i % 3 === 1) {
    registry.unregister(seen.handle);
    unregistered.add(seen.token);
  }`;
    if (!inner)
      text.push(`function make${id}(i: number): { held: (${type}) | null; seen: Seen } {
  const x: ${type} = ${make};
  return { held: x, seen: watch(x) };
}
async function case${id}(i: number): Promise<void> {
  const box = make${id}(i);
  const seen = box.seen;
  await turn();
  const x = await use${id}(box, i);
  verify("${id} ${name}", seen, x);
  if (!(${holds})) wrong.add("${id} ${name}");
  ${ending}
}`);
    else {
      const part = held === "{ i: number }" ? "inner" : held === "number[]" ? "list" : "point";
      text.push(`function make${id}(i: number): { held: (${held}) | null; seen: Seen; seenInside: Seen[] } {
  const outer: Outer = { inner: { i }, list: [i, i + 1], point: new Point(i, 1), i };
  return { held: ${inner === "the-inner-one-alone" ? `outer.${part}` : "outer"}, seen: watch(${inner === "the-inner-one-alone" ? `outer.${part}` : "outer"}), seenInside: ${inner === "the-inner-one-alone" ? "[]" : "[watch(outer.inner), watch(outer.list), watch(outer.point)]"} };
}
async function case${id}(i: number): Promise<void> {
  const box = make${id}(i);
  const seen = box.seen;
  await turn();
  const x = await use${id}(box, i);
  verify("${id} ${name}", seen, x);
  ${
    inner === "the-inner-one-alone"
      ? `if (!(${part === "inner" ? "x.i === i" : part === "list" ? "x.length === 2 && x[0] === i && x[1] === i + 1" : "x.sum === i + 1"})) wrong.add("${id} ${name}");`
      : `verify("${id} ${name}: inner", box.seenInside[0], x.inner);
  verify("${id} ${name}: list", box.seenInside[1], x.list);
  verify("${id} ${name}: point", box.seenInside[2], x.point);
  if (!(x.i === i && x.inner.i === i && x.list[1] === i + 1 && x.point.sum === i + 1)) wrong.add("${id} ${name}");`
  }
  ${ending}
}`);
    }
    text.push(`for (let i = ${id * 100}; i < ${id * 100 + rounds}; i++) await case${id}(i);`);
  }
  text.splice(3, 0, `type Outer = { inner: { i: number }; list: number[]; point: Point; i: number };`);
  text.push(`for (let n = 0; n < 4; n++) {
  collect();
  await turn();
}
for (const [x, seen] of kept) verify("kept to the end", seen, x);
for (const [token, times] of finalized) {
  if (times > 1) early.add("finalized twice");
  if (unregistered.has(token)) early.add("finalized after unregister");
}
console.log("lost: " + [...lost].sort().join(", "));
console.log("wrong: " + [...wrong].sort().join(", "));
console.log("early: " + [...early].sort().join(", "));
console.log("kept " + kept.length + " of " + tokens);`);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
