// Generators and async generators that are left half way: closed, thrown into, dropped, or asked again while they run, at every place where they can stand.
//
//   bodies    drawn: yields with and without an answer, yield*, waits, try with catch, with finally, with both, nested; loops over other generators and over iterators written by hand; returns, throws, breaks and continues,
//             also inside a finally; resources that are disposed; variables of every kind that live across each stop and are printed behind it
//   inner     generators that yield, throw or return in their finally; iterators without `return`, whose `return` throws, answers no object, or is an accessor
//   left by   next, return and throw in any order, with and without values; break, return, throw and continue to a label in a for-of; patterns, with holes, with a rest, with targets that throw; spreads, Array.from, Set, Map,
//             Object.fromEntries, Promise.all; the helpers of iterators; a call of itself while it runs; nobody: dropped and collected
//   async     the same, each answer awaited, or all requests at once; return with a promise, a rejected promise, a thenable that throws; for await left in the middle
//
// Every step prints a mark with the variables as they are, so the program prints the road it took.
import type { Random } from "./random";

const prelude = `declare const Bun: { gc(full: boolean): unknown };
const marks: string[] = [];
class Failure extends Error {
  id: number;
  constructor(id: number) {
    super("failure " + id);
    this.id = id;
  }
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
type Steps = Generator<number, number, number | undefined>;
type SlowSteps = AsyncGenerator<number, number, number | undefined>;
function describe(value: unknown): string {
  if (value instanceof Failure) return "F" + value.id;
  if (value instanceof Error) return value.name + ": " + value.message;
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(describe).join() + "]" : "object";
  return Object.is(value, -0) ? "-0" : String(value);
}
function mark(...parts: unknown[]): void {
  marks.push(parts.map(describe).join(" "));
}
function flush(name: string): void {
  console.log(name + ": " + marks.join(" | "));
  marks.length = 0;
}
function step(name: string, run: () => IteratorResult<number, number>): void {
  try {
    const result = run();
    mark(name, result.done, result.value);
  } catch (error) {
    mark(name, "threw", error);
  }
}
async function slowStep(name: string, promise: Promise<IteratorResult<number, number>>): Promise<void> {
  try {
    const result = await promise;
    mark(name, result.done, result.value);
  } catch (error) {
    mark(name, "threw", error);
  }
}
function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function later(value: number): Promise<number> {
  return new Promise(resolve => queueMicrotask(() => resolve(value)));
}
function resource(id: number): Disposable {
  mark("opened", id);
  return {
    [Symbol.dispose]() {
      mark("disposed", id);
    },
  };
}
let current: Steps | undefined;
function askAgain(): string {
  try {
    return describe(current?.next().value);
  } catch (error) {
    return describe(error);
  }
}
function closeAgain(): string {
  try {
    return describe(current?.return(-5).value);
  } catch (error) {
    return describe(error);
  }
}
function* plainInner(k: number): Steps {
  try {
    const got = yield k;
    yield k + (got ?? 1);
    return k + 2;
  } finally {
    mark("inner closed", k);
  }
}
function* yieldsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner closing", k);
    yield k + 100;
    mark("inner closed late", k);
  }
}
function* throwsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner throws", k);
    throw new Failure(k + 200);
  }
}
function* returnsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner returns", k);
    return k + 300;
  }
}
function* catchesAndGoesOn(k: number): Steps {
  for (let i = 0; i < 4; i++) {
    try {
      yield k + i;
    } catch (error) {
      mark("inner caught", error);
    }
  }
  return k + 9;
}
function byHand(k: number, kind: number): Steps {
  let i = 0;
  const iterator: any = {
    [Symbol.iterator]() {
      return this;
    },
    next(value: unknown) {
      mark("hand next", k, value);
      return i < 3 ? { value: k + i++, done: false } : { value: k + 50, done: true };
    },
  };
  if (kind === 1) iterator.return = (value: unknown) => (mark("hand return", k, value), { value, done: true });
  if (kind === 2)
    iterator.return = () => {
      mark("hand return throws", k);
      throw new Failure(k + 400);
    };
  if (kind === 3) iterator.return = () => (mark("hand return answers a number", k), 5);
  if (kind === 4)
    Object.defineProperty(iterator, "return", {
      get() {
        mark("hand return read", k);
        return undefined;
      },
    });
  if (kind === 5) iterator.throw = (error: unknown) => (mark("hand throw", k, error), { value: k + 60, done: false });
  return iterator;
}
async function* slowInner(k: number): SlowSteps {
  try {
    yield k;
    await null;
    yield k + 1;
    return k + 2;
  } finally {
    mark("slow inner closing", k);
    await null;
    mark("slow inner closed", k);
  }
}`;

const inners = ["plainInner(K)", "yieldsInFinally(K)", "throwsInFinally(K)", "returnsInFinally(K)", "catchesAndGoesOn(K)", "byHand(K, 0)", "byHand(K, 1)", "byHand(K, 2)", "byHand(K, 3)", "byHand(K, 4)", "byHand(K, 5)"];

class Writer {
  tag = 0;
  constructor(
    readonly random: Random,
    readonly isAsync: boolean,
  ) {}
  state(): string {
    // Mostly read right here: a list that is handed to another function is another case for a compiler.
    return this.random.chance(0.8) ? `mark(${++this.tag}, n, f, o.x, t, list.length, list[0], list[list.length - 1]);` : `mark(${++this.tag}, n, f, o.x, t, list.length, total(list));`;
  }
  inner(): string {
    return this.random.pick(inners).replace("K", String(this.random.between(1, 9) * 10));
  }
  block(depth: number, inLoop: boolean, inFinally: boolean): string {
    const count = this.random.between(1, depth > 0 ? 4 : 3);
    const lines: string[] = [];
    for (let i = 0; i < count; i++) lines.push(this.statement(depth, inLoop, inFinally));
    return lines.join("\n");
  }
  statement(depth: number, inLoop: boolean, inFinally: boolean): string {
    const r = this.random;
    const k = r.between(1, 9);
    const simple: [number, () => string][] = [
      [4, () => `yield n + ${k};\n${this.state()}`],
      [4, () => `got = yield ${k};\nmark(${++this.tag}, got);`],
      [3, () => `n += ${k};\nf += 0.25;\no.x += 1;\nt += "${"abcdefghi"[k - 1]}";\nlist.push(n);`],
      [2, () => this.state()],
      [2, () => `n += yield* ${this.inner()};\n${this.state()}`],
      [1, () => `if (n % ${r.between(2, 3)} === 0) return n + ${k * 1000};`],
      [1, () => `if (n % ${r.between(2, 4)} === 1) throw new Failure(${++this.tag});`],
      [1, () => `using r${++this.tag} = resource(${this.tag});`],
      [1, () => `mark(${++this.tag}, ${r.pick(["askAgain()", "closeAgain()"])});`],
      [1, () => `o = new Point(n, o.x);\nyield o.y;\n${this.state()}`],
      [1, () => `f = (yield f) ?? f * 2;\n${this.state()}`],
    ];
    if (this.isAsync) simple.push([3, () => "await null;"], [3, () => `n += await later(${k});\n${this.state()}`], [1, () => `yield later(${k}) as unknown as number;`], [1, () => `n += yield* slowInner(${k * 10});`]);
    if (inLoop) simple.push([1, () => `if (n % 2 === ${r.between(0, 1)}) break;`], [1, () => `if (n % 3 === ${r.between(0, 2)}) continue;`]);
    if (inFinally) simple.push([1, () => `if (n % 2 === ${r.between(0, 1)}) return ${k * 10000};`]);
    if (depth <= 0) return r.weighted(simple)();
    const nested: [number, () => string][] = [
      [5, () => `try {\n${this.block(depth - 1, inLoop, inFinally)}\n} finally {\nmark(${++this.tag}, "finally");\n${this.block(depth - 1, false, true)}\n}`],
      [3, () => `try {\n${this.block(depth - 1, inLoop, inFinally)}\n} catch (error) {\nmark(${++this.tag}, "caught", error);\n${this.block(depth - 1, inLoop, inFinally)}\n}`],
      [3, () => `try {\n${this.block(depth - 1, inLoop, inFinally)}\n} catch (error) {\nmark(${++this.tag}, "caught", error);\n${this.block(depth - 2, inLoop, inFinally)}\n} finally {\nmark(${++this.tag}, "finally");\n${this.block(depth - 2, false, true)}\n}`],
      [3, () => `for (const x of ${this.inner()}) {\nn += x;\n${this.block(depth - 1, true, inFinally)}\n}`],
      [2, () => `for (let i = 0; i < ${r.between(2, 3)}; i++) {\nn += i;\n${this.block(depth - 1, true, inFinally)}\n}`],
      [1, () => `{\nconst [a${++this.tag}, b${this.tag}] = ${this.inner()};\nn += a${this.tag} + (b${this.tag} ?? 0);\n${this.block(depth - 1, inLoop, inFinally)}\n}`],
    ];
    if (this.isAsync) nested.push([3, () => `for await (const x of slowInner(${k * 10})) {\nn += x;\n${this.block(depth - 1, true, inFinally)}\n}`]);
    return r.weighted([...simple, ...nested.map(([weight, write]) => [weight * 2, write] as [number, () => string])])();
  }
}

// `G` makes the generator anew.
const consumers: Record<string, string> = {
  "break": "for (const x of G) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) break;\n  }",
  "return": "(() => {\n    for (const x of G) {\n      mark(\"saw\", x);\n      if (++seen > LIMIT) return;\n    }\n  })();",
  "throw": "for (const x of G) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) throw new Failure(-1);\n  }",
  "continue-outer": "outer: for (let i = 0; i < 2; i++) {\n    for (const x of G) {\n      mark(\"saw\", i, x);\n      if (++seen > LIMIT) continue outer;\n    }\n  }",
  "to-the-end": "for (const x of G) mark(\"saw\", x);",
  pattern: "const [a, b] = G;\n  mark(a, b);",
  "pattern-with-a-hole": "const [, a, , b] = G;\n  mark(a, b);",
  "pattern-with-a-rest": "const [a, ...rest] = G;\n  mark(a, rest);",
  "empty-pattern": "const [] = G;",
  "pattern-with-defaults": "const [a = (mark(\"default\"), 1), b = 2] = G;\n  mark(a, b);",
  "targets-that-throw": "const target = {\n    set a(value: number) {\n      mark(\"stored\", value);\n      if (++seen > LIMIT) throw new Failure(-2);\n    },\n  };\n  [target.a, target.a, target.a] = G;",
  spread: "mark([...G]);",
  "call-with-a-spread": "mark(Math.max(...G));",
  "array-from": "mark(\n    Array.from(G, x => {\n      if (++seen > LIMIT) throw new Failure(-3);\n      return x;\n    }),\n  );",
  set: "mark(new Set(G).size);",
  map: "mark(new Map(G as any).size);",
  "from-entries": "mark(Object.fromEntries(G as any));",
  take: "mark((G as any).take(LIMIT).toArray());",
  drop: "mark((G as any).drop(LIMIT).next().value);",
  "map-then-return": "const mapped = (G as any).map((x: number) => x * 2);\n  mark(mapped.next().value);\n  mark(mapped.return().done);",
  "flat-map": "mark((G as any).flatMap((x: number) => plainInner(x)).take(LIMIT + 1).toArray());",
  some: "mark((G as any).some((x: number) => ++seen > LIMIT));",
  find: "mark((G as any).find((x: number) => ++seen > LIMIT));",
  "reduce-that-throws": "mark(\n    (G as any).reduce((sum: number, x: number) => {\n      if (++seen > LIMIT) throw new Failure(-4);\n      return sum + x;\n    }, 0),\n  );",
  "through-yield-star": "function* outer(): Steps {\n    try {\n      return yield* G;\n    } finally {\n      mark(\"outer closed\");\n    }\n  }\n  for (const x of outer()) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) break;\n  }",
  dropped: "let g: Steps | undefined = G;\n  for (let i = 0; i <= LIMIT; i++) mark(g.next().value);\n  g = undefined;\n  Bun.gc(true);",
};
const slowConsumers: Record<string, string> = {
  "break": "for await (const x of G) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) break;\n  }",
  "throw": "for await (const x of G) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) throw new Failure(-1);\n  }",
  "return": "await (async () => {\n    for await (const x of G) {\n      mark(\"saw\", x);\n      if (++seen > LIMIT) return;\n    }\n  })();",
  "to-the-end": "for await (const x of G) mark(\"saw\", x);",
  "break-behind-a-wait": "for await (const x of G) {\n    await later(1);\n    mark(\"saw\", x);\n    if (++seen > LIMIT) break;\n  }",
  "from-async": "mark(await (Array as any).fromAsync(G));",
  "through-yield-star": "async function* outer(): SlowSteps {\n    try {\n      return yield* G;\n    } finally {\n      mark(\"outer closed\");\n    }\n  }\n  for await (const x of outer()) {\n    mark(\"saw\", x);\n    if (++seen > LIMIT) break;\n  }",
  dropped: "let g: SlowSteps | undefined = G;\n  for (let i = 0; i <= LIMIT; i++) mark((await g.next()).value);\n  g = undefined;\n  Bun.gc(true);\n  await later(1);",
};

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [prelude];
  const calls: string[] = [];
  const scenes = random.between(3, 7);
  for (let id = 1; id <= scenes; id++) {
    const isAsync = random.chance(0.4);
    const writer = new Writer(random, isAsync);
    const form = random.pick(["function", "method", "static-method", "expression"]);
    const head = `(start: number): ${isAsync ? "SlowSteps" : "Steps"} {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
${writer.block(random.between(1, 3), false, false)}
${writer.state()}
return n;
}`;
    const star = isAsync ? "async " : "";
    text.push(
      form === "function"
        ? `${star}function* steps${id}${head}`
        : form === "method"
          ? `const home${id} = {\n${star}*steps${head},\n};\nconst steps${id} = (start: number) => home${id}.steps(start);`
          : form === "static-method"
            ? `class Home${id} {\nstatic ${star}*steps${head}\n}\nconst steps${id} = (start: number) => Home${id}.steps(start);`
            : `const steps${id} = ${star}function* ${head};`,
    );
    const start = random.between(0, 9);
    const make = `steps${id}(${start})`;
    const way = random.weighted([[5, "requests"], [4, "consumer"], [isAsync ? 3 : 0, "all-at-once"]] as const);
    let body: string;
    if (way === "consumer") {
      const table = isAsync ? slowConsumers : consumers;
      const name = random.pick(Object.keys(table));
      names.push(`${isAsync ? "async-" : ""}${form}-${name}`);
      body = `let seen = 0;\n  try {\n  ${table[name].replaceAll("G", make).replaceAll("LIMIT", String(random.between(0, 3)))}\n  } catch (error) {\n    mark("threw", error);\n  }\n  mark("seen", seen);`;
    } else {
      const requests: string[] = [];
      const count = random.between(2, 8);
      for (let i = 0; i < count; i++) {
        requests.push(
          random.weighted([
            [6, "g.next()"],
            [3, `g.next(${random.between(1, 9)})`],
            [3, `g.return(${random.between(1, 9) * 11})`],
            [3, `g.throw(new Failure(${-10 - i}))`],
            [isAsync ? 1 : 0, `g.return(later(${i}) as unknown as number)`],
            [isAsync ? 1 : 0, `g.return(Promise.reject(new Failure(${-20 - i})) as unknown as number)`],
            [isAsync ? 1 : 0, `g.return({ then() { throw new Failure(${-30 - i}); } } as unknown as number)`],
          ] as const),
        );
      }
      names.push(`${isAsync ? "async-" : ""}${form}-${way}-${count}`);
      const label = (request: string) => JSON.stringify(request.replace(/^g\./, "").replace(/\(.*/, ""));
      body =
        way === "all-at-once"
          ? `const g = ${make};\n  const all = [${requests.join(", ")}];\n  ${requests.map((request, at) => `await slowStep(${label(request)}, all[${at}]);`).join("\n  ")}`
          : isAsync
            ? `const g = ${make};\n  ${requests.map(request => `await slowStep(${label(request)}, ${request});`).join("\n  ")}`
            : `const g = ${make};\n  current = g;\n  ${requests.map(request => `step(${label(request)}, () => ${request});`).join("\n  ")}\n  current = undefined;`;
    }
    text.push(`${isAsync ? "async " : ""}function scene${id}(): ${isAsync ? "Promise<void>" : "void"} {\n  ${body}\n  flush("${id}");\n}`);
    calls.push(`${isAsync ? "await " : ""}scene${id}();`);
  }
  text.push(calls.join("\n"));
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
