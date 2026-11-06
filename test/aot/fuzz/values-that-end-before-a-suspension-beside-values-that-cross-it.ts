// Coroutines that hold many values at once. Some values are last read before a suspension. Others are read again behind it: straight on, in a later
// turn of a loop, in a catch, in a finally, or only when the caller throws into the coroutine or returns from it. Every read is printed.
import type { Random } from "./random";

const kinds = [
  "async function",
  "async arrow",
  "async method",
  "generator",
  "generator method",
  "async generator",
] as const;
type Kind = (typeof kinds)[number];

const isAsync = (kind: Kind) => kind.startsWith("async");
const canYield = (kind: Kind) => kind.includes("generator");

type Maker = { isNumber: boolean; make: (seed: number) => string };
const makers: readonly Maker[] = [
  { isNumber: true, make: seed => `(pass(${seed}) | 0) + ${seed % 7}` },
  { isNumber: true, make: seed => `pass(${seed}.5) * 1.25` },
  { isNumber: true, make: seed => (seed % 2 ? `pass(-0)` : `pass(0) / 0`) },
  { isNumber: false, make: seed => `pass(${seed}) > ${seed % 3 ? seed - 1 : seed + 1}` },
  { isNumber: false, make: seed => `"s" + pass(${seed})` },
  { isNumber: false, make: seed => `{ first: pass(${seed}), second: "t${seed}" }` },
  { isNumber: false, make: seed => `[pass(${seed}), ${seed}.5, "u"]` },
  { isNumber: false, make: seed => `new Box(pass(${seed}), ${seed})` },
  { isNumber: false, make: seed => `BigInt(pass(${seed})) * 3n` },
  { isNumber: false, make: seed => `() => pass(${seed}) + ${seed % 5}` },
  { isNumber: false, make: seed => `pass(${seed % 2 ? "null" : "undefined"})` },
  { isNumber: false, make: seed => `Symbol.for("y" + pass(${seed}))` },
];
const numberMakers = makers.filter(maker => maker.isNumber);

const fewValues = [0, 1, 2, 3, 5, 8, 13, 16, 24] as const;
const manyValues = [
  31, 32, 33, 48, 62, 63, 64, 65, 66, 96, 124, 125, 126, 127, 128, 129, 130, 131, 160, 200, 252, 253, 254, 255, 256,
  257, 258, 259, 300, 400, 520,
] as const;

const disturbances = [
  ``,
  `Bun.gc(true);`,
  `churn(300);`,
  `descend(200, 1, "d");`,
  `Bun.gc(true); churn(300); Bun.gc(true);`,
  `descend(200, 1, "d"); Bun.gc(true);`,
] as const;

const head = (disturbance: string) => `const lines = [];
function show(value) {
  if (typeof value === "function") return "function>" + show(value());
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (value instanceof Box) return "Box(" + show(value.held) + "," + show(value.extra) + ")";
  if (value instanceof Error) return "Error(" + value.message + ")";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(label, ...values) {
  lines.push(label + ": " + values.map(show).join(" "));
}
function mix(...values) {
  let sum = 7;
  for (const value of values) for (const unit of show(value)) sum = (sum * 31 + unit.charCodeAt(0)) | 0;
  return sum;
}
class Box {
  constructor(held, extra) {
    this.held = held;
    this.extra = extra;
  }
}
const passers = [value => value, value => value];
let passes = 0;
function pass(value) {
  return passers[passes++ & 1](value);
}
function churn(count) {
  const kept = [];
  for (let index = 0; index < count; index++) kept.push({ index, text: "c" + index, list: [index] });
  return kept.length;
}
function descend(depth, number, text) {
  const pair = { number, text };
  return depth === 0 ? show(pair).length : descend(depth - 1, number + 1, text) + (pair.number & 1);
}
function disturb() {
  ${disturbance}
}
async function answerLater(value) {
  await null;
  return value;
}
async function failLater(value) {
  await null;
  throw new Error("failed " + value);
}
function* countUp(value) {
  const got = yield value;
  yield mix(got, value);
  return value + 1;
}
const registry = new FinalizationRegistry(markCollected => markCollected());
function readName(value) {
  return value.name.length;
}
`;

class Coroutine {
  private counter = 0;
  private hasRecursion = false;
  private largeBlocksLeft: number;
  readonly crossing: string[] = ["first", "second"];

  constructor(
    private readonly random: Random,
    readonly kind: Kind,
    readonly call: string,
    largeBlocks: number,
    private readonly isWatching: boolean,
    private readonly countsRounds: boolean,
    // Timers of several coroutines that run together fire in an order that depends on the clock.
    private readonly mayUseTimers: boolean,
  ) {
    this.largeBlocksLeft = largeBlocks;
    for (let index = random.between(1, random.chance(0.2) ? 40 : 9); index > 0; index--)
      this.crossing.push(`kept${index}`);
  }

  private seed() {
    return ++this.counter;
  }

  private some(most: number) {
    return this.random.sample(this.crossing, this.random.between(1, Math.min(most, this.crossing.length)));
  }

  private read(label: string) {
    const count = this.random.chance(0.15) ? this.crossing.length : 4;
    return `note(${JSON.stringify(`${label} ${this.seed()}`)}, ${this.some(count).join(", ")}, sum);`;
  }

  private assign() {
    const names = this.some(this.random.chance(0.2) ? this.crossing.length : 3).filter(name => name.startsWith("kept"));
    const from = this.random.chance(0.25) ? numberMakers : makers;
    return names.map(name => `${name} = ${this.random.pick(from).make(this.seed())};`);
  }

  // Values that are all alive at once and are last read here.
  private endValues(): string[] {
    let count: number = this.random.pick(fewValues);
    if (this.largeBlocksLeft > 0 && this.random.chance(0.5)) {
      this.largeBlocksLeft--;
      count = this.random.pick(manyValues);
    }
    if (count === 0) return [];
    const areNumbers = this.random.chance(0.3);
    const names = Array.from({ length: count }, (_, index) => `ending${index}`);
    const lines = names.map(
      name => `const ${name} = ${this.random.pick(areNumbers ? numberMakers : makers).make(this.seed())};`,
    );
    const list = names.join(", ");
    const uses = [
      `sum = mix(sum, ${list});`,
      `sum = mix(sum, [${list}]);`,
      `sum = mix(sum, Array.of(${list}));`,
      `const list = [];\nlist.push(${list});\nsum = mix(sum, list.splice(0));`,
      ...(count <= 66
        ? [
            [...names]
              .reverse()
              .map(name => `sum = mix(sum, ${name});`)
              .join("\n"),
          ]
        : []),
      ...(areNumbers
        ? [`sum = mix(sum, ${names.join(" + ")});`, `sum = mix(sum, Math.max(${list}), Math.min(${list}));`]
        : []),
    ];
    return ["{", ...lines, this.random.pick(uses), "}"];
  }

  private operand(mayFail: boolean): string {
    const seed = this.seed();
    const awaited = [
      `await null`,
      `await pass(${seed})`,
      `await Promise.resolve(pass(${seed}))`,
      `await { then(resolve) { disturb(); resolve(${seed}); } }`,
      `await answerLater(${seed})`,
      `await Promise.all([pass(${seed}), Promise.resolve(${seed + 1})])`,
      ...(this.mayUseTimers
        ? [`await new Promise(resolve => setTimeout(resolve, 0, ${seed}))`, `await Bun.sleep(0)`]
        : []),
    ];
    const failing = [
      `await Promise.reject(new Error("rejected ${seed}"))`,
      `await { then(resolve, reject) { disturb(); reject(new Error("refused ${seed}")); } }`,
      `await failLater(${seed})`,
    ];
    const yielded = [
      `yield ${seed}`,
      `yield pass(${seed})`,
      `yield* [${seed}, ${seed + 1}]`,
      `yield* countUp(${seed})`,
      `yield mix(sum, ${seed})`,
    ];
    const choices: string[] = [];
    if (isAsync(this.kind)) choices.push(...(mayFail && this.random.chance(0.6) ? failing : awaited));
    if (canYield(this.kind)) choices.push(...yielded);
    return `(${this.random.pick(choices)})`;
  }

  private suspend(mayFail: boolean, isAtTheTop: boolean): string {
    const [left, right] = [this.random.pick(this.crossing), this.random.pick(this.crossing)];
    if (isAtTheTop && !this.hasRecursion && this.random.chance(0.25)) {
      this.hasRecursion = true;
      const again = `${canYield(this.kind) ? "yield*" : "await"} ${this.call}(${left}, second, depth - 1)`;
      return `sum = mix(sum, depth > 0 ? ${again} : ${this.operand(false)});`;
    }
    const wait = this.operand(mayFail);
    const forms = [
      `${wait};`,
      `sum = mix(sum, ${wait});`,
      `sum = mix(${left}, ${wait}, ${right});`,
      `sum = mix(sum, [${left}, ${wait}, ${right}]);`,
      `sum = mix(sum, { first: ${left}, second: ${wait}, third: ${right} });`,
      `sum = mix(sum, Array.of(${left}, ${wait}, ${right}, ${this.operand(false)}, ${left}));`,
      `sum = mix(sum, new Box(${left}, ${wait}));`,
      `sum = mix(sum, ${wait} ? ${left} : ${right});`,
      `sum = mix(sum, show(${left}) + show(${wait}) + show(${right}));`,
      `sum = mix(sum, Array.of(${Array.from({ length: this.random.between(2, 30) }, () => this.random.pick(makers).make(this.seed())).join(", ")}, ${wait}, ${right}));`,
    ];
    if (isAsync(this.kind))
      forms.push(
        `for await (const item of [pass(${this.seed()}), Promise.resolve(${left})]) sum = mix(sum, item, ${right});`,
      );
    return this.random.pick(forms);
  }

  private step(mayFail: boolean, isAtTheTop: boolean): string[] {
    const lines: string[] = [];
    if (this.random.chance(0.6)) lines.push(...this.assign());
    lines.push(...this.endValues());
    if (this.random.chance(0.3)) lines.push(this.read("before"));
    lines.push(this.suspend(mayFail, isAtTheTop));
    if (this.random.chance(0.3)) lines.push(this.random.pick([`Bun.gc(true);`, `disturb();`, `churn(50);`]));
    if (this.random.chance(0.7)) lines.push(this.read("behind"));
    return lines;
  }

  private block(depth: number): string[] {
    const shape =
      depth >= 2
        ? "step"
        : this.random.weighted([
            [5, "step"],
            [2, "loop"],
            [3, "try"],
          ] as const);
    if (shape === "step") return this.step(false, depth === 0);
    const inner = () => Array.from({ length: this.random.between(1, 2) }, () => this.block(depth + 1)).flat();
    if (shape === "loop") {
      const turn = `turn${this.seed()}`;
      const turns = this.random.between(1, 4);
      return [
        `for (let ${turn} = 0; ${turn} < ${turns}; ${turn}++) {`,
        ...inner(),
        `if (${turn} === ${this.random.below(turns)}) ${this.read("one turn")}`,
        `sum = mix(sum, ${turn});`,
        `}`,
      ];
    }
    const lines = [`try {`, ...inner(), ...this.step(true, false), ...(this.random.chance(0.5) ? inner() : []), `}`];
    const hasCatch = this.random.chance(0.7);
    if (hasCatch)
      lines.push(
        `catch (error) {`,
        `note("caught ${this.seed()}", error);`,
        this.read("in the catch"),
        ...(this.random.chance(0.4) ? this.step(false, false) : []),
        `}`,
      );
    if (!hasCatch || this.random.chance(0.6))
      lines.push(
        `finally {`,
        this.read("in the finally"),
        ...(this.random.chance(0.4) ? this.step(false, false) : []),
        `}`,
      );
    return lines;
  }

  // An object that is last read before a loop that collects and waits.
  private watch(): string[] {
    const wait =
      this.kind === "async generator" && this.random.chance(0.3)
        ? `if (round === 0) yield round;\nawait Bun.sleep(0);`
        : `await Bun.sleep(0);`;
    return [
      `await Bun.sleep(0);`,
      `let isCollected = false;`,
      `{`,
      `const watched = { name: "w" + pass(${this.seed()}) };`,
      `registry.register(watched, () => void (isCollected = true));`,
      ...this.endValues().slice(1, -1),
      `sum = mix(sum, readName(watched), readName(watched), watched);`,
      `}`,
      `for (let round = 0; !isCollected && round < 300; round++) {`,
      ...(this.countsRounds ? [`rounds++;`] : []),
      `Bun.gc(true);`,
      wait,
      `}`,
      `note("watched", isCollected ? "collected" : "still held");`,
    ];
  }

  body(): string {
    const blocks = Array.from({ length: this.random.between(1, 4) }, () => this.block(0)).flat();
    const kept = this.crossing.filter(name => name.startsWith("kept"));
    return [
      `let sum = mix(first, depth);`,
      `let ${kept.join(", ")};`,
      ...blocks,
      ...(this.isWatching ? this.watch() : []),
      `note("end", ${this.crossing.join(", ")}, sum);`,
      `return sum;`,
    ].join("\n");
  }
}

function declare(kind: Kind, name: string, body: string): string {
  const parameters = `(first, second, depth)`;
  switch (kind) {
    case "async function":
      return `async function ${name}${parameters} {\n${body}\n}`;
    case "async arrow":
      return `const ${name} = async ${parameters} => {\n${body}\n};`;
    case "async method":
      return `const holderOf${name} = {\nasync run${parameters} {\n${body}\n},\n};`;
    case "generator":
      return `function* ${name}${parameters} {\n${body}\n}`;
    case "generator method":
      return `const holderOf${name} = {\n*run${parameters} {\n${body}\n},\n};`;
    case "async generator":
      return `async function* ${name}${parameters} {\n${body}\n}`;
  }
}

const drivers = `function act(iterator, action, step) {
  if (action === "throw") return iterator.throw(new Error("thrown in at " + step));
  if (action === "return") return iterator.return("returned at " + step);
  return iterator.next(step);
}
function actionAt(script, step) {
  return script[Math.min(step, script.length - 1)];
}
function driveGenerators(label, iterators, script) {
  const steps = iterators.map(() => 0);
  const isDone = iterators.map(() => false);
  for (let round = 0; round < 3000 && isDone.includes(false); round++) {
    const at = round % iterators.length;
    if (isDone[at]) continue;
    try {
      const result = act(iterators[at], actionAt(script, steps[at]), steps[at]);
      note(label + " " + at, steps[at], result.value, result.done);
      isDone[at] = result.done;
    } catch (error) {
      note(label + " " + at + " threw", steps[at], error);
      isDone[at] = true;
    }
    steps[at]++;
    disturb();
  }
}
async function driveAsyncGenerators(label, iterators, script) {
  await Promise.all(
    iterators.map(async (iterator, at) => {
      for (let step = 0; step < 3000; step++) {
        try {
          const result = await act(iterator, actionAt(script, step), step);
          note(label + " " + at, step, result.value, result.done);
          if (result.done) return;
        } catch (error) {
          note(label + " " + at + " threw", step, error);
          return;
        }
        disturb();
      }
    }),
  );
}
async function walkAsyncGenerator(label, iterator, last) {
  let step = 0;
  try {
    for await (const value of iterator) {
      note(label, step, value);
      if (step++ === last) break;
    }
  } catch (error) {
    note(label + " threw", step, error);
  }
}
async function driveAsyncFunctions(label, promises) {
  for (const result of await Promise.allSettled(promises)) note(label, result.status, result.status === "fulfilled" ? result.value : result.reason);
}
`;

const firstArguments = [`1`, `2.5`, `"a"`, `{ first: 1 }`, `[1, 2]`, `null`, `new Box(1, 2)`, `7n`] as const;

// With `mayWatch`, some coroutines also report whether an object that they last read before a loop of collections and waits was collected by the end
// of the loop. With `countsRounds`, the last line is the number of turns that these loops took, which no other line depends on.
export function generate(random: Random, mayWatch = false, countsRounds = false): string {
  const parts: string[] = [head(random.pick(disturbances)), drivers];
  const runs: string[] = [];
  let largeBlocks = random.weighted([
    [5, 0],
    [4, 1],
    [1, 2],
  ] as const);
  const count = random.between(1, 3);
  for (let index = 0; index < count; index++) {
    const kind = random.pick(kinds);
    const name = `coroutine${index}`;
    const call = kind.endsWith("method") ? `holderOf${name}.run` : name;
    const isWatching = isAsync(kind) && random.chance(0.2) && mayWatch;
    const together = isWatching ? 1 : random.between(1, 3);
    const coroutine = new Coroutine(random, kind, call, largeBlocks, isWatching, countsRounds, together === 1);
    largeBlocks = 0;
    parts.push(declare(kind, name, coroutine.body()));

    const depth = isWatching
      ? 0
      : random.weighted([
          [6, 0],
          [2, 1],
          [2, 3],
          [1, 20],
          [1, 120],
        ] as const);
    const times =
      isWatching || depth > 3
        ? 1
        : random.weighted([
            [5, 1],
            [2, 3],
            [1, 30],
          ] as const);
    const eachCall = Array.from(
      { length: together },
      () => `${call}(${random.pick(firstArguments)}, ${random.pick(firstArguments)}, ${depth})`,
    );
    const calls = eachCall.join(", ");
    const script = Array.from({ length: random.between(1, 12) }, () => `"next"`);
    if (random.chance(0.6)) script[random.below(script.length)] = random.chance(0.5) ? `"throw"` : `"return"`;
    script.push(`"next"`);
    const label = JSON.stringify(`${kind} ${index}`);
    const run =
      kind === "async generator"
        ? random.chance(0.3)
          ? `await walkAsyncGenerator(${label}, ${eachCall[0]}, ${random.below(8)});`
          : `await driveAsyncGenerators(${label}, [${calls}], [${script.join(", ")}]);`
        : canYield(kind)
          ? `driveGenerators(${label}, [${calls}], [${script.join(", ")}]);`
          : `await driveAsyncFunctions(${label}, [${calls}]);`;
    runs.push(times === 1 ? run : `for (let time = 0; time < ${times}; time++) {\n${run}\n}`);
  }
  if (countsRounds) parts.push(`let rounds = 0;`);
  parts.push(`async function main() {\n${runs.join("\n")}\n}`);
  parts.push(`function print() {
  note("registry", typeof registry.register);
  console.log(lines.slice(0, 600).join("\\n"));
  console.log(lines.length, mix(lines.filter(line => !line.startsWith("watched: "))));${countsRounds ? `\n  console.log("rounds", rounds);` : ""}
}
main().then(print, error => {
  note("main failed", error);
  print();
});
`);
  return parts.join("\n");
}
