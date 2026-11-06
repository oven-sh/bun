// Every kind of job that the queue of microtasks holds, each with fresh objects that nothing else holds, and each running long enough for collections to begin and end inside it, beside a heap that stays.
//
//   heap      trees of up to a million objects that stay, a long array and a large Map that take new members all the time: a collection takes long, and much is suspended and resumed beside it
//   jobs      an async function goes on, fulfilled or rejected; it awaits another async function directly, in chains of up to ten; the elements of Promise.all, allSettled, race and any, 2 to 40 of them;
//             handlers of then, catch and finally whose own promise nobody holds; thenables; queueMicrotask; the body of an async generator, its yields, requests that queue up, return() and throw() from outside, yield*,
//             a generator that nobody holds once next() is called
//   awaited   nothing, promises that are settled, promises as old as the program at which many wait, async functions, thenables
//   entered   from the end of the module, a timer, setImmediate, a message of a MessageChannel, a message from another thread
//   contexts  in half of the programs each task runs under a store of AsyncLocalStorage that nothing else holds
//   held      objects with one, two, three and seven fields, strings made at run time, ropes, bigints, symbols, closures, arrays, typed arrays, Maps, Sets, generators, errors, regular expressions; under their types and as `unknown`
//   holders   a variable of the function that waits; a ring for each kind of value, as old as the program, whose slots are read and filled anew all the time; a slot of the long array, a key of the large Map, a value of a WeakMap whose key the function holds
//   depth     behind a resumption 1 to 14 frames of other functions, each with objects of its own, and the innermost allocates
//   frames    2 to 70 variables alive over a wait
//
// Each task folds what it held into a number; the program prints one line for each kind of task. Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

const prelude = `import { AsyncLocalStorage } from "node:async_hooks";
declare function setImmediate(callback: () => void): unknown;
class One {
  constructor(public n: number) {}
}
class Two {
  constructor(
    public one: One,
    public other: One | null,
  ) {}
}
class Three {
  constructor(
    public n: number,
    public label: string,
    public one: One,
  ) {}
}
class Seven {
  a: number;
  b: string;
  c: One;
  d: Two | null;
  e: number;
  f: number[];
  g: Three;
  constructor(n: number) {
    this.a = n | 0;
    this.b = String(n & 1023);
    this.c = new One(n + 1);
    this.d = n & 1 ? new Two(this.c, n & 2 ? new One(n + 2) : null) : null;
    this.e = n * 0.5;
    this.f = [n, n * 0.25];
    this.g = new Three(n + 3, "g" + (n & 31), new One(n + 4));
  }
}
class Branch {
  left: Branch | null = null;
  right: Branch | null = null;
  constructor(public item: Three) {}
}
function text(v: string): number {
  return (v.length * 131 + v.charCodeAt(v.length - 1)) | 0;
}
function one(v: One): number {
  return v.n | 0;
}
function two(v: Two | null): number {
  return v === null ? 5 : (v.one.n * 3 + (v.other === null ? 7 : v.other.n)) | 0;
}
function three(v: Three): number {
  return (v.n ^ text(v.label) ^ (v.one.n * 17)) | 0;
}
function seven(v: Seven): number {
  return (v.a + text(v.b) + one(v.c) + two(v.d) + ((v.e * 2) | 0) + v.f.length + ((v.f[1] * 4) | 0) + three(v.g)) | 0;
}
function make(n: number): Three {
  return new Three(n | 0, String(n & 4095), new One((n + 1) | 0));
}
function add(a: number, b: number): number {
  return (a + b) | 0;
}
function* counts(from: number): Generator<One, number, unknown> {
  for (let i = from; ; i++) yield new One(i);
}
function step(v: Generator<One, number, unknown>): number {
  const result = v.next();
  return result.done ? -1 : result.value.n | 0;
}
const ring: unknown[] = new Array(64).fill(null);
function churn(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = new One(i);
    const b = new Two(a, i & 1 ? new One(i + 1) : null);
    const c = new Three(i, String(i), a);
    ring[i & 63] = i & 2 ? b : c;
    sum = (sum + one(a) + two(b) + three(c)) | 0;
    if ((i & 7) === 0) ring[(i + 1) & 63] = new Seven(i);
    if ((i & 15) === 0) ring[(i + 2) & 63] = ["r" + i + "-" + sum, () => a.n, [a, a, a], BigInt(i) << 70n, Symbol("c")];
  }
  return sum;
}
function sink(depth: number, carried: Three, work: number): number {
  const mine = make(depth + carried.n);
  const name = String(depth * 7 + carried.n);
  const below = depth > 0 ? sink(depth - 1, depth & 1 ? mine : carried, work) : churn(work);
  return (below + three(mine) + three(carried) + text(name)) | 0;
}
const kept: unknown[] = [];
function grow(depth: number, n: number): Branch {
  const branch = new Branch(make(n));
  if (depth > 0) {
    branch.left = grow(depth - 1, n * 2);
    branch.right = grow(depth - 1, n * 2 + 1);
  }
  return branch;
}
let places = 0;
const loose: Promise<unknown>[] = [];
const registry = new Map<number, Three>();
const weak = new WeakMap<One, Three>();
async function later(x: number): Promise<number> {
  return (x + 1) | 0;
}
async function laterThree(x: number): Promise<Three> {
  await null;
  return make(x);
}
async function refuses(x: number): Promise<number> {
  await null;
  throw make(x);
}
function timer(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function immediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
function microtask(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}
function message(x: number): Promise<number> {
  return new Promise(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = event => {
      port1.close();
      port2.close();
      resolve(event.data as number);
    };
    port2.postMessage(x);
  });
}
const gates: ((value: number) => void)[] = [];
function gate(): Promise<number> {
  return new Promise(resolve => gates.push(resolve));
}
function open(value: number): void {
  const resolve = gates.shift();
  if (resolve) resolve(value);
}
// Promises that are old when somebody awaits them: many wait at one door, and a door that is open stays open.
const doors: Promise<number>[] = [];
const keys: ((value: number) => void)[] = [];
for (let i = 0; i < 16; i++) doors.push(new Promise<number>(resolve => keys.push(resolve)));
let unlocked = 0;
function unlock(): void {
  if (unlocked < keys.length) keys[unlocked](++unlocked);
}
// Where several threads run this program, each also opens the gates of the others.
const others = new BroadcastChannel("every-kind-of-job");
others.onmessage = () => open(0);
function shout(): void {
  others.postMessage(1);
}
function thenable(run: (v: number) => number): PromiseLike<number> {
  const made = {
    then(resolve: (value: number) => void): void {
      resolve(run(2));
    },
  };
  return made as unknown as PromiseLike<number>;
}
const storage = new AsyncLocalStorage<Three>();
function stored(): number {
  const store = storage.getStore();
  return store === undefined ? 9 : three(store);
}
function taken(result: IteratorResult<Three, number>): number {
  return result.done ? (result.value * 3) | 0 : three(result.value);
}
async function thrownInto(stream: AsyncGenerator<Three, number, unknown>, x: number): Promise<number> {
  try {
    return taken(await stream.throw(make(x)));
  } catch (thrown) {
    return (three(thrown as Three) + 1) | 0;
  }
}
`;

type Value = readonly [type: string, fold: (name: string) => string, make: (x: string) => string];

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const notes: string[] = [];
  const hasContexts = random.chance(0.5);
  const trees = pick([0, 0, 2, 10, 10, 40, 40, 120]);
  const shelf = pick([64, 5000, 5000, 200_000]);
  const works = pick([
    [0, 3, 30],
    [0, 3, 30, 300],
    [3, 30, 300, 2500],
    [30, 300, 2500, 2500, 10_000],
  ]);
  text.push(`const shelf: (Three | null)[] = new Array(${shelf}).fill(null);
const free: number[] = Array.from({ length: ${shelf} }, (_, at) => at);
function take(): number {
  const at = free.pop();
  return at === undefined ? shelf.push(null) - 1 : at;
}
function leave(at: number): void {
  shelf[at] = null;
  free.push(at);
}`);
  const members = pick([0, 1000, 50_000]);
  notes.push(`${trees} trees`, `a shelf of ${shelf}`, `work ${works.join(" ")}`, hasContexts ? "contexts" : "no contexts");

  let names = 0;
  // How many turns of churn() the text written so far takes, and how often what is being written runs.
  let cost = 0;
  let times = 1;

  const values: Value[] = [
    ["One", name => `one(${name})`, x => `new One(${x})`],
    ["One", name => `one(${name})`, x => `new One(${x})`],
    ["Two", name => `two(${name})`, x => `new Two(new One(${x}), ${pick(["null", `new One(${below(99)})`])})`],
    ["Two | null", name => `two(${name})`, x => `(${x}) & 1 ? new Two(new One(${x}), new One(1)) : null`],
    ["Three", name => `three(${name})`, x => pick([`make(${x})`, `new Three(${x}, "t" + (${x}), new One(${below(99)}))`])],
    ["Three", name => `three(${name})`, x => `make(${x})`],
    ["Seven", name => `seven(${name})`, x => `new Seven(${x})`],
    ["string", name => `text(${name})`, x => pick([`String(${x})`, `String(${x})`, `"s" + (${x})`, `(${x}).toString(36)`, `JSON.stringify([${x}])`, `[${x}, 1].join("+")`, `("abcdefgh" + (${x})).slice(2)`, `"ab".repeat(((${x}) & 3) + 1)`])],
    ["bigint", name => `Number(${name} % 1000003n)`, x => `BigInt(${x}) * 1000000007n + 12345678901234567890n`],
    ["symbol", name => `text(${name}.description ?? "")`, x => `Symbol("y" + (${x}))`],
    ["() => number", name => `${name}()`, x => `(held => () => three(held) + 1)(make(${x}))`],
    ["One[]", name => `(${name}.length * 3 + one(${name}[${name}.length - 1]))`, x => `[new One(${x}), new One(${below(99)})${below(2) ? `, new One(${below(9)})` : ""}]`],
    ["number[]", name => `(${name}.length + ((${name}[1] * 4) | 0))`, x => `[${x}, (${x}) * 0.25, ${below(9)}]`],
    ["Map<number, Three>", name => `(${name}.size + three(${name}.get(1)!))`, x => `new Map([[1, make(${x})], [2, make(${below(9)})]])`],
    ["Set<One>", name => `(${name}.size * 5 + one([...${name}][0]))`, x => `new Set([new One(${x}), new One(${below(9)})])`],
    ["{ a: One; b: number }", name => `(one(${name}.a) + ((${name}.b * 2) | 0))`, x => `{ a: new One(${x}), b: (${x}) * 0.5 }`],
    ["{ a: One; b: Two; c: string; d: number; e: Three }", name => `(one(${name}.a) + two(${name}.b) + text(${name}.c) + ${name}.d + three(${name}.e))`, x => `{ a: new One(${x}), b: new Two(new One(2), null), c: String(${x}), d: ${below(99)}, e: make(${x}) }`],
    ["Generator<One, number, unknown>", name => `step(${name})`, x => `counts(${x})`],
    ["Float64Array", name => `((${name}[1] * 8) | 0)`, x => `new Float64Array([${x}, (${x}) * 0.125])`],
    ["Uint8Array", name => `(${name}[0] + ${name}.length)`, x => `new Uint8Array([${x}, 2, 3])`],
    ["Error", name => `text(${name}.message)`, x => `new RangeError("e" + (${x}))`],
    ["RegExp", name => `text(${name}.source)`, x => `new RegExp("a" + ((${x}) & 7) + "+")`],
  ];

  // One ring for each kind of value, as old as the program: a turn reads what an earlier turn has put there and puts something new in its place. The turns are numbered as they come, so the sum does not depend on who takes them.
  const ringSize = pick([61, 257, 257, 1021]);
  values.forEach(([type], at) => text.push(`const ring${at}: ((${type}) | null)[] = new Array(${ringSize}).fill(null);`));
  text.push(`let spun = 0;
let spinSum = 0;
function spin(n: number): number {
  for (let i = 0; i < n; i++) {
    const round = spun++;
    const slot = round % ${ringSize};
${values.map(([, fold, make], at) => `    const old${at} = ring${at}[slot];\n    if (old${at} !== null) spinSum = (spinSum + ${fold("old" + at)}) | 0;\n    ring${at}[slot] = ${make("round")};`).join("\n")}
  }
  return n;
}`);
  // The heap that stays is made behind the rings, the shelf and the doors: they are old when the tasks begin.
  text.push(`for (let i = 0; i < ${trees}; i++) kept.push(grow(12, i));`);
  text.push(`for (let i = 0; i < ${members}; i++) registry.set(-1 - i, make(i));`);

  // Functions that call one another down to the one that allocates, each with objects of its own.
  const chains: string[] = [];
  for (let chain = 0, count = random.between(1, 3); chain < count; chain++) {
    const depth = pick([1, 2, 4, 8, 12, 14]);
    for (let level = 0; level < depth; level++) {
      const mine = Array.from({ length: random.between(1, 3) }, () => pick(values));
      const call = level + 1 < depth ? `down${chain}_${level + 1}(${pick(["carried", "make(carried.n + 1)", "carried"])}, work)` : "churn(work)";
      text.push(`function down${chain}_${level}(carried: Three, work: number): number {
  ${mine.map(([type, , make], at) => `const m${at}: ${type} = ${make(pick(["carried.n", "work", `${below(99)}`]))};`).join("\n  ")}
  const below = ${call};
  return (below + three(carried)${mine.map(([, fold], at) => ` + ${fold("m" + at)}`).join("")}) | 0;
}`);
    }
    chains.push(`down${chain}_0`);
  }

  const work = (x: string) => {
    const turns = pick(works);
    cost += (turns + 2) * times;
    return pick([`churn(${turns})`, `churn(${turns})`, `spin(${Math.ceil(turns / 8)})`, `spin(${Math.ceil(turns / 8)})`, `${pick(chains)}(make(${x}), ${turns})`, `${pick(chains)}(make(${x}), ${turns})`, `sink(${pick([1, 3, 6, 12])}, make(${x}), ${turns})`]);
  };

  /** The body of a function that cannot wait: it makes objects, works, and answers with what they fold into. `numbers` are the numbers it can see. */
  const handler = (numbers: readonly string[]) => {
    const mine = Array.from({ length: below(4) }, () => [pick(values), "s" + names++] as const);
    const worked = "w" + names++;
    return `{ ${mine.map(([[type, , make], name]) => `const ${name}: ${type} = ${make(pick(numbers))};`).join(" ")} const ${worked} = ${work(pick(numbers))}; return (${numbers[0]} + ${worked}${hasContexts && !below(3) ? " + stored()" : ""}${mine.map(([[, fold], name]) => ` + ${fold(name)}`).join("")}) | 0; }`;
  };

  interface Place {
    /** 0: waits, objects, work and handlers. 1: also the helpers of level 0. 2: also those of level 1. */
    level: number;
    isGenerator: boolean;
    budget: number;
  }
  const helpers: { name: string; cost: number }[][] = [[], []];
  const streams: { name: string; cost: number }[] = [];

  /** The statements of an async function or an async generator with the numbers `k` (never assigned) and `sum`. */
  const body = (place: Place, wide: number): { text: string; tail: string } => {
    const held: { name: string; fold: string; renew: () => string }[] = [];
    const number = () => pick(["k", "sum", "(k + sum)", `${below(50)}`, "(sum & 255)", "k"]);
    const plus = (expression: string) => `sum = (sum + ${expression}) | 0;`;
    const declare = () => {
      const [type, fold, make] = pick(values);
      const name = "h" + names++;
      // Under its type, or as a value that the compiler knows nothing about.
      const isHidden = !below(5);
      held.push({ name, fold: fold(isHidden ? `(${name} as ${type.includes("=>") || type.includes("|") ? `(${type})` : type})` : name), renew: () => `${name} = ${make(number())};` });
      return `let ${name}: ${isHidden ? "unknown" : type} = ${make(number())};`;
    };
    const use = () => (held.length ? plus(pick(held).fold) : plus("1"));
    const renew = () => (held.length ? pick(held).renew() : declare());
    const start = () => pick([`Promise.resolve(${number()})`, `Promise.resolve(${number()})`, `later(${number()})`, `timer(${pick([0, 1, 2])}).then(() => ${number() === "sum" ? "k" : "k + 1"})`, `message(${number()})`, `microtask().then(() => k)`]);
    const seen = ["v", "k"] as const;
    const wait = () =>
      pick(["await null;", "await null;", plus(`(await later(${number()}))`), plus(`(await later(${number()}))`), "await microtask();", `await timer(${pick([0, 0, 1, 1, 2, 5, 12])});`, "await immediate();", `shout(); await Promise.race([gate(), timer(${pick([1, 3])})]);`,
        plus(`(await message(${number()}))`), `await Promise.resolve(${number()});`, plus(`(await doors[${number()} & 15])`), plus(`(await doors[${number()} & 15])`), plus(`(await doors[${below(16)}])`), plus(`three(await laterThree(${number()}))`), "open(1); await Promise.race([gate(), timer(1)]);"]); // prettier-ignore
    const called = (from: { name: string; cost: number }[]) => {
      const helper = pick(from);
      cost += helper.cost * times;
      return helper.name;
    };
    const jobs: (() => string)[] = [
      // Handlers in a row. Nobody holds the promises between them.
      () => plus(`(await ${start()}.then(v => ${handler(seen)})${below(2) ? `.then(v => ${handler(seen)})` : ""}${below(3) ? "" : `.then(v => ${handler(seen)})`})`),
      // Nobody holds the last promise either.
      () => plus(`(await new Promise<number>(done => { void ${start()}.then(v => ${handler(seen)}).then(v => { done((() => ${handler(seen)})()); }); }))`),
      () => plus(`(await refuses(${number()}).then(v => v, (thrown: unknown) => { const v = three(thrown as Three); return (() => ${handler(seen)})(); }))`),
      () => plus(`(await refuses(${number()}).catch((thrown: unknown) => { const v = three(thrown as Three); return (() => ${handler(seen)})(); }).finally(() => { const v = 1; (() => ${handler(seen)})(); }))`),
      () => plus(`(await thenable(v => ${handler(seen)}))`),
      () => plus(`(await new Promise<number>(done => queueMicrotask(() => { const v = 3; done((() => ${handler(seen)})()); })))`),
      () => plus(`(await new Promise<number>(done => ${pick([`setTimeout(() => { const v = 4; done((() => ${handler(seen)})()); }, ${pick([0, 1, 3])})`, `setImmediate(() => { const v = 5; done((() => ${handler(seen)})()); })`])}))`),
      // A promise that is settled long before somebody awaits it.
      () => {
        const name = "p" + names++;
        return `const ${name} = ${pick([`laterThree(${number()})`, `Promise.resolve(make(${number()}))`, `timer(1).then(() => make(k))`])}; ${wait()}${plus(work(number()))}${plus(`three(await ${name})`)}`;
      },
      () => {
        const place = "at" + names++;
        return `const ${place} = take(); shelf[${place}] = make(${number()}); ${wait()}${below(2) ? plus(work(number())) : ""}${plus(`three(shelf[${place}]!)`)} leave(${place});`;
      },
      () => {
        const key = "key" + names++;
        return `const ${key} = places++; registry.set(${key}, make(${number()})); ${wait()}${below(2) ? plus(work(number())) : ""}${plus(`three(registry.get(${key})!)`)} registry.delete(${key});`;
      },
      () => {
        const key = "key" + names++;
        return `const ${key} = new One(${number()}); weak.set(${key}, make(${number()})); ${wait()}${below(2) ? plus(work(number())) : ""}${plus(`three(weak.get(${key})!)`)}`;
      },
    ];
    if (hasContexts)
      jobs.push(
        () => plus(`(await storage.run(make(${number()}), async () => { ${wait().replace(/sum = \(sum \+ (.*)\) \| 0;/, "$1;").replace(/\bsum\b/g, "k")} const before = stored(); const worked = ${work("k")}; await ${pick(["null", "timer(1)", "microtask()", "later(1)"])}; return (before + worked + stored()) | 0; }))`),
        () => plus(`(await storage.run(make(${number()}), () => ${start().replace(/\bsum\b/g, "k")}.then(v => ${handler(seen)}).then(v => (v + stored()) | 0)))`),
      );
    if (place.level > 0) {
      const mine = helpers[place.level - 1];
      const elements = (count: number) => Array.from({ length: count }, (_, at) => `${called(mine)}(${at ? `k + ${at}` : number()})`).join(", ");
      jobs.push(
        () => plus(`(await ${called(mine)}(${number()}))`),
        () => plus(`(await ${called(mine)}(${number()}))`),
        () => plus(`(await Promise.all([${elements(pick([2, 3, 3, 8, 31, 32, 33, 40]))}])).reduce(add, 0)`),
        () => plus(`(await Promise.all([${elements(pick([2, 3, 5]))}].map(each => each.then(v => ${handler(seen)})))).reduce(add, 0)`),
        () => plus(`(await Promise.allSettled([${elements(pick([2, 4]))}, refuses(k)])).length`),
        // Those that lose go on; the program waits for them at its end.
        () => `const racers = [${elements(2)}]; loose.push(...racers); await Promise.race([...racers, timer(${pick([0, 1, 4])})]);`,
        () => `const racers = [${elements(2)}]; loose.push(...racers); await Promise.any([refuses(k), ...racers]);`,
      );
    }
    if (streams.length && place.level > 0) {
      const stream = () => `${called(streams)}(${1 + below(5)}, ${number()})`;
      jobs.push(
        () => `for await (const item of ${stream()}) {${below(2) ? wait() : ""}${plus("three(item)")}${use()}${below(2) ? plus(work(number())) : ""}${below(3) ? "" : "if (sum & 1) break;"}}`,
        () => `for await (const item of ${stream()}) {${plus("three(item)")}}`,
        // Nobody holds the generator once it has been asked.
        () => plus(`taken(await ${stream()}.next())`),
        () => plus(`(await ${stream()}.next().then(result => { const v = taken(result); return (() => ${handler(seen)})(); }))`),
        () => {
          const name = "g" + names++;
          return `const ${name} = ${stream()}; ${plus(`(await Promise.all([${name}.next(), ${name}.next(), ${name}.next()${below(2) ? `, ${name}.return(${below(9)})` : ""}${below(2) ? `, ${name}.next()` : ""}])).map(taken).reduce(add, 0)`)}${below(2) ? plus(`taken(await ${name}.return(7))`) : ""}`;
        },
        () => {
          const name = "g" + names++;
          return `const ${name} = ${stream()}; ${plus(`taken(await ${name}.next())`)}${wait()}${plus(`(await thrownInto(${name}, ${number()}))`)}${plus(`taken(await ${name}.next())`)}`;
        },
      );
    }
    const statements = (left: number): string => {
      let all = "";
      for (let more = 2 + below(4); more-- && place.budget > 0; ) {
        place.budget--;
        const inner = () => {
          const before = held.length;
          const block = statements(left - 1);
          held.length = before;
          return block;
        };
        const repeated = (write: (turns: number) => string) => {
          const turns = 2 + below(3);
          times *= turns;
          const written = write(turns);
          times /= turns;
          return written;
        };
        switch (left > 0 ? below(26) : below(18)) {
          case 0: case 1: all += declare(); break; // prettier-ignore
          case 2: case 3: all += wait(); break; // prettier-ignore
          case 4: all += use(); break; // prettier-ignore
          case 5: all += renew(); break; // prettier-ignore
          case 6: case 7: all += `${wait()}${plus(work(number()))}${use()}`; break; // prettier-ignore
          case 8: all += `${declare()}${wait()}${use()}`; break; // prettier-ignore
          // Read for the last time in front of a wait.
          case 9: all += `{ const gone = make(${number()}); ${plus("three(gone)")} } ${wait()}`; break; // prettier-ignore
          case 10: case 11: case 12: case 13: case 14: case 15: case 16: all += `{ ${pick(jobs)()} }`; break; // prettier-ignore
          case 17: all += place.isGenerator ? `${below(2) ? declare() : ""}yield make(${number()});${use()}` : `{ ${pick(jobs)()} }`; break; // prettier-ignore
          case 18: case 19: all += repeated(turns => `for (let c${names} = 0; c${names} < ${turns}; c${names++}++) {${inner()}${wait()}${use()}}`); break; // prettier-ignore
          case 20: all += `if (${pick(["sum & 1", "k & 1", "sum > k", "(k + sum) % 3 === 0"])}) {${inner()}${wait()}} else {${inner()}}`; break; // prettier-ignore
          case 21: {
            // Only one path assigns it, and only that path reads it, with waits between.
            const [name, test] = ["o" + names++, pick(["(k & 1) === 0", "k % 3 === 1", "(k & 4) !== 0"])];
            all += `let ${name}: Three | null = null; if (${test}) ${name} = make(${number()}); ${wait()}${inner()}${wait()} if (${test}) ${plus(`three(${name}!)`)}`;
            break;
          }
          case 22: all += `try {${inner()}${plus(`(await refuses(${number()}))`)}} catch (thrown) { ${wait()}${plus("three(thrown as Three)")}${use()}} finally {${wait()}${use()}}`; break; // prettier-ignore
          case 23: all += `try {${inner()}${place.isGenerator ? `yield make(${number()});` : wait()}} finally {${use()}${wait()}${use()}}`; break; // prettier-ignore
          case 24: all += repeated(turns => `{ const first = new Branch(make(${number()})); let last = first; for (let c${names} = 0; c${names} < ${turns}; c${names++}++) { last.left = new Branch(make(sum + 1)); last = last.left; ${wait()} } ${plus("three(first.item) + three(last.item)")} }`); break; // prettier-ignore
          default: all += `${use()}${wait()}`; // prettier-ignore
        }
      }
      return all;
    };
    let all = "";
    for (let i = 0; i < wide; i++) all += declare();
    all += statements(place.level > 1 ? random.between(2, 3) : random.between(1, 2));
    return { text: all.replace(/([;{}])(?=[^\n])/g, "$1\n"), tail: held.map(each => ` + ${each.fold}`).join("") };
  };

  const written = (write: () => string) => {
    const before = cost;
    cost = 0;
    const result = write();
    const mine = cost + 5;
    cost = before;
    return { result, cost: mine };
  };

  for (let level = 0; level < 2; level++) {
    for (let helper = 0, count = random.between(1, 3); helper < count; helper++) {
      const name = `helper${level}_${helper}`;
      const { result, cost: mine } = written(() => {
        const { text, tail } = body({ level, isGenerator: false, budget: pick([3, 6, 12]) }, below(3));
        return `async function ${name}(k: number): Promise<number> {\n  let sum = k | 0;\n  ${text}\n  return (sum${tail}) | 0;\n}`;
      });
      text.push(result);
      helpers[level].push({ name, cost: mine });
    }
    if (level === 0) {
      for (let stream = 0, count = random.between(1, 2); stream < count; stream++) {
        const name = `stream${stream}`;
        const { result, cost: mine } = written(() => {
          times = 3;
          const { text, tail } = body({ level: 0, isGenerator: true, budget: pick([3, 6, 12]) }, below(3));
          times = 1;
          return `async function* ${name}(count: number, k: number): AsyncGenerator<Three, number, unknown> {\n  let sum = k | 0;\n  for (let turn = 0; turn < count; turn++) {\n  ${text}\n  yield make(sum + turn);\n  sum = (sum${tail}) | 0;\n  }\n  return sum;\n}`;
        });
        text.push(result);
        streams.push({ name, cost: mine });
      }
      const inner = streams[0];
      text.push(`async function* relay(count: number, k: number): AsyncGenerator<Three, number, unknown> {\n  const mine = make(k);\n  const sum = yield* ${inner.name}(count, k);\n  yield mine;\n  return (sum + three(mine)) | 0;\n}`);
      streams.push({ name: "relay", cost: inner.cost });
    }
  }
  // Async functions that await one another directly, each with objects of its own; the innermost waits for something outside.
  {
    const depth = pick([2, 4, 10]);
    for (let level = 0; level < depth; level++) {
      const mine = Array.from({ length: random.between(1, 3) }, () => pick(values));
      text.push(`async function up${level}(k: number): Promise<number> {
  ${mine.map(([type, , make], at) => `const m${at}: ${type} = ${make(pick(["k", `${below(99)}`]))};`).join("\n  ")}
  const below = ${level + 1 < depth ? `await up${level + 1}(k + 1)` : `(await ${pick(["timer(1)", "timer(0)", "immediate()", "microtask()", "null"])}, churn(${pick(works)}))`};
  return (below${mine.map(([, fold], at) => ` + ${fold("m" + at)}`).join("")}) | 0;
}`);
    }
    helpers[1].push({ name: "up0", cost: 100 });
  }

  const kinds = random.between(1, 3);
  for (let kind = 0; kind < kinds; kind++) {
    const { result, cost: mine } = written(() => {
      const { text, tail } = body({ level: 2, isGenerator: false, budget: pick([8, 16, 30, 60]) }, pick([0, 0, 2, 6, 30, 70]));
      return `async function task${kind}(k: number): Promise<number> {\n  let sum = k | 0;\n  ${text}\n  return (sum${tail}) | 0;\n}`;
    });
    text.push(result);
    const tasks = Math.max(3, Math.min(pick([8, 40, 150, 400]), Math.floor(300_000 / kinds / mine)));
    notes.push(`${tasks} tasks of ${result.length} characters and ${mine} turns`);
    const begin = pick([`task${kind}(k)`, `task${kind}(k)`, `new Promise<number>(resolve => setTimeout(() => resolve(task${kind}(k)), k % 7))`, `Promise.resolve(k).then(task${kind})`, `new Promise<number>(resolve => setImmediate(() => resolve(task${kind}(k))))`, ...(hasContexts ? [`storage.run(make(k), () => task${kind}(k))`, `storage.run(make(k), () => task${kind}(k))`] : [])]);
    text.push(`const started${kind} = Array.from({ length: ${tasks} }, (_, k) => ${begin});`);
  }
  text.push(`{
  const pulse = setInterval(() => {
    open(1);
    unlock();
    churn(${pick([0, 20, 200])});
  }, 1);
${Array.from({ length: kinds }, (_, kind) => `  console.log("task${kind} " + (await Promise.all(started${kind})).reduce((a, b) => (Math.imul(a, 31) + b) | 0, 0));`).join("\n")}
  for (let i = 0; i < loose.length; i++) await loose[i];
  clearInterval(pulse);
  others.close();
  console.log("kept " + kept.length + " " + registry.size + " spun " + spun + " " + spinSum);
}`);
  return `// ${notes.join(" . ")}\n${text.join("\n")}`;
}
