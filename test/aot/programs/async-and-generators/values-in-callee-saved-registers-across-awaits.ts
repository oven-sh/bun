// A function that suspends keeps its values across the await or the yield, and whoever resumes it keeps its own across the step. Here both sides hold many values of every kind (integers, fractions,
// strings, objects, bigints, symbols), with calls before and behind each suspension, so that the values lie in the registers that a callee preserves as well as in the frame. A generator is stepped
// by another caller each time: callers that hold integers, fractions or objects, deep in the stack, in a callback of a built-in, in another generator, behind an await. An async function is resumed
// from the event loop, from a drain of the queue in a function that holds values itself, by the end of the function that it waits for, and in a row with others that wait for the same promise.
// Calls with more arguments than there are registers stand before and behind the suspensions, and collections run while only the suspended frames hold the objects.
declare const gc: undefined | (() => void);
declare const drainMicrotasks: undefined | (() => void);
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
const drain: () => void = typeof drainMicrotasks === "function" ? drainMicrotasks : require("bun:jsc").drainMicrotasks;
const settled = Promise.resolve();
const lines: string[] = [];

// Every value comes from here, so none can be computed again behind a call.
let state = 20261019;
function draw(): number {
  state = (state * 48271) % 2147483647;
  return state % 1000;
}
// A call that stays a call.
let worked = 0;
function work(depth: number): number {
  worked++;
  return depth > 0 ? work(depth - 1) + 1 : 0;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
interface Gate {
  promise: Promise<number>;
  open: (value: number) => void;
}
function makeGate(): Gate {
  let open: (value: number) => void = () => {};
  const promise = new Promise<number>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

type Texts = Generator<string, string, number>;
function* keeps1(): Texts { const a = draw(); work(1); const s = yield [a].join(); work(1); const t = yield [a, s].join(); work(1); return [a, s, t].join(); }
function* keeps2(): Texts { const a = draw(), b = draw(); work(1); const s = yield [a, b].join(); work(1); const t = yield [b, a, s].join(); work(1); return [a, b, s, t].join(); }
function* keeps3(): Texts { const a = draw(), b = draw(), c = draw(); work(1); const s = yield [a, b, c].join(); work(1); const t = yield [c, b, a, s].join(); work(1); return [b, a, c, s, t].join(); }
function* keeps4(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(); work(1); const s = yield [a, b, c, d].join(); work(1); const t = yield [d, c, b, a, s].join(); work(1); return [b, a, d, c, s, t].join(); }
function* keeps5(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(); work(1); const s = yield [a, b, c, d, e].join(); work(1); const t = yield [e, d, c, b, a, s].join(); work(1); return [b, a, d, c, e, s, t].join(); }
function* keeps6(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(); work(1); const s = yield [a, b, c, d, e, f].join(); work(1); const t = yield [f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, s, t].join(); }
function* keeps7(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(); work(1); const s = yield [a, b, c, d, e, f, g].join(); work(1); const t = yield [g, f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, g, s, t].join(); }
function* keeps8(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(); work(1); const s = yield [a, b, c, d, e, f, g, h].join(); work(1); const t = yield [h, g, f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, h, g, s, t].join(); }
function* keeps10(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(), i = draw(), j = draw(); work(1); const s = yield [a, b, c, d, e, f, g, h, i, j].join(); work(1); const t = yield [j, i, h, g, f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, h, g, j, i, s, t].join(); }
function* keeps14(): Texts { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(), i = draw(), j = draw(), k = draw(), l = draw(), m = draw(), n = draw(); work(1); const s = yield [a, b, c, d, e, f, g, h, i, j, k, l, m, n].join(); work(1); const t = yield [n, m, l, k, j, i, h, g, f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, h, g, j, i, l, k, n, m, s, t].join(); }
function* keepsFractions3(): Texts { const a = draw() / 8, b = draw() / 8, c = draw() / 8; work(1); const s = yield [a, b, c].join(); work(1); const t = yield [c, b, a, s].join(); work(1); return [b, a, c, s, t].join(); }
function* keepsFractions10(): Texts { const a = draw() / 8, b = draw() / 8, c = draw() / 8, d = draw() / 8, e = draw() / 8, f = draw() / 8, g = draw() / 8, h = draw() / 8, i = draw() / 8, j = draw() / 8; work(1); const s = yield [a, b, c, d, e, f, g, h, i, j].join(); work(1); const t = yield [j, i, h, g, f, e, d, c, b, a, s].join(); work(1); return [b, a, d, c, f, e, h, g, j, i, s, t].join(); }
function* keepsCells(): Texts {
  const a = "a" + draw(), b = { n: draw() }, c = [draw(), draw()], d = new Point(draw(), draw()), e = BigInt(draw()), f = Symbol("f" + draw());
  work(1);
  const s = yield [a, b.n, c.join("+"), d.x, d.y, e, f.description].join();
  work(1);
  const t = yield [f.description, e, d.y, d.x, c.join("+"), b.n, a, s].join();
  work(1);
  return [b.n, a, d.x, c.join("+"), e, d.y, f.description, s, t].join();
}
function* keepsEveryKind(rounds: number): Texts {
  let i = draw(), j = draw(), k = draw(), l = draw();
  let d = draw() / 8, e = draw() / 16;
  let s = "s" + draw();
  let b = draw() % 2 === 0;
  const o = { n: draw() };
  const p = new Point(draw(), draw());
  const a = [draw(), draw()];
  let g = BigInt(draw());
  const y = Symbol("y" + draw());
  const c = draw();
  const f = (): number => c + 1;
  let u: number | undefined = draw() % 2 ? draw() : undefined;
  let x: any = draw() % 2 ? "x" + draw() : draw();
  for (let round = 0; round < rounds; round++) {
    i += work(1);
    d += work(2) / 4;
    const sent = yield [i, j, k, l, d, e, s, b, o.n, p.x, p.y, a.join("+"), g, y.description, f(), u, x].join(" ");
    work(1);
    j += sent;
    k = (k + j) % 1009;
    l ^= k;
    e += d / 2;
    s += sent;
    b = !b;
    o.n += sent;
    p.x += p.y;
    a.push(sent);
    g += BigInt(sent);
    u = u === undefined ? sent : undefined;
    x = typeof x === "string" ? x.length : "x" + x;
  }
  return [x, u, f(), y.description, g, a.join("+"), p.y, p.x, o.n, b, s, e, d, l, k, j, i].join(" ");
}

// Whoever steps a generator holds values of its own across the step.
type Stepper = (generator: Texts, sent: number) => string;
function show(result: IteratorResult<string, string>): string {
  return (result.done ? "returned " : "yielded ") + result.value;
}
function stepsBesideNothing(generator: Texts, sent: number): string {
  return "nothing: " + show(generator.next(sent));
}
function stepsBesideIntegers(generator: Texts, sent: number): string {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw();
  const result = generator.next(sent);
  return "integers " + [a, b, c, d, e, f, g, h].join() + ": " + show(result);
}
function stepsBesideFractions(generator: Texts, sent: number): string {
  const a = draw() / 8, b = draw() / 8, c = draw() / 8, d = draw() / 8, e = draw() / 8, f = draw() / 8, g = draw() / 8, h = draw() / 8, i = draw() / 8, j = draw() / 8;
  const result = generator.next(sent);
  return "fractions " + [a, b, c, d, e, f, g, h, i, j].join() + ": " + show(result);
}
function stepsBesideCells(generator: Texts, sent: number): string {
  const a = "a" + draw(), b = { n: draw() }, c = [draw()], d = new Point(draw(), draw()), e = BigInt(draw()), f = Symbol("f" + draw());
  const result = generator.next(sent);
  return "cells " + [a, b.n, c[0], d.x, d.y, e, f.description].join() + ": " + show(result);
}
function stepsBesideAMixture(generator: Texts, sent: number): string {
  const a = draw(), b = draw() / 8, c = "c" + draw(), d = draw(), e = draw() / 8, f = { n: draw() }, g = draw(), h = draw() / 8, i = [draw()], j = draw(), k = draw() / 8, l = draw() % 2 === 0;
  work(1);
  const result = generator.next(sent);
  work(1);
  return "a mixture " + [a, b, c, d, e, f.n, g, h, i[0], j, k, l].join() + ": " + show(result);
}
function descends(depth: number, generator: Texts, sent: number): string {
  const a = draw(), b = draw();
  const text = depth ? descends(depth - 1, generator, sent) : stepsBesideIntegers(generator, sent);
  return depth % 4 ? text : text + " <" + a + "," + b;
}
function stepsDeepInTheStack(generator: Texts, sent: number): string {
  return "deep, " + descends(12, generator, sent);
}
function stepsInACallback(generator: Texts, sent: number): string {
  const a = draw(), b = draw(), c = draw() / 8;
  const texts = [sent].map(value => stepsBesideFractions(generator, value));
  return "a callback " + [a, b, c].join() + ", " + texts[0];
}
function stepsInAComparator(generator: Texts, sent: number): string {
  const a = draw(), b = draw(), c = "c" + draw();
  let text = "";
  [2, 1].sort((left, right) => {
    if (!text) text = stepsBesideCells(generator, sent);
    return left - right;
  });
  return "a comparator " + [a, b, c].join() + ", " + text;
}
function* relaysAStep(generator: Texts, sent: number): Generator<string, void, unknown> {
  const a = draw(), b = draw(), c = draw(), d = draw() / 8;
  work(1);
  const result = generator.next(sent);
  work(1);
  yield "a generator " + [a, b, c, d].join() + ": " + show(result);
}
function stepsInAGenerator(generator: Texts, sent: number): string {
  const a = draw(), b = draw();
  const text = relaysAStep(generator, sent).next().value as string;
  return text + " <" + a + "," + b;
}
function stepsInALoop(generator: Texts, sent: number): string {
  let a = draw(), b = draw(), c = draw(), d = draw();
  let text = "";
  for (let i = 0; i < 3; i++) {
    if (i === 1) text = show(generator.next(sent));
    else work(1);
    a += b;
    b ^= c;
    c = (c + d) % 1009;
    d += i;
  }
  return "a loop " + [a, b, c, d].join() + ": " + text;
}
const steppers: Stepper[] = [
  stepsBesideIntegers,
  stepsBesideFractions,
  stepsBesideCells,
  stepsBesideNothing,
  stepsBesideAMixture,
  stepsDeepInTheStack,
  stepsInACallback,
  stepsInAComparator,
  stepsInAGenerator,
  stepsInALoop,
];
const generators: [label: string, make: () => Texts][] = [
  ["1 integer", keeps1],
  ["2 integers", keeps2],
  ["3 integers", keeps3],
  ["4 integers", keeps4],
  ["5 integers", keeps5],
  ["6 integers", keeps6],
  ["7 integers", keeps7],
  ["8 integers", keeps8],
  ["10 integers", keeps10],
  ["14 integers", keeps14],
  ["3 fractions", keepsFractions3],
  ["10 fractions", keepsFractions10],
  ["cells", keepsCells],
  ["every kind", () => keepsEveryKind(2)],
];
function stepGenerators(): void {
  lines.push("== generators, each step by another caller");
  let turn = 0;
  for (let offset = 0; offset < 4; offset++) {
    for (const [label, make] of generators) {
      const generator = make();
      for (let step = 0; step < 3; step++) {
        lines.push(label + ", " + steppers[(turn += 1 + offset) % steppers.length](generator, 100 + step));
        if (turn % 7 === 0) collect();
      }
    }
  }
  const long = keepsEveryKind(steppers.length * 2);
  for (let step = 0; step <= steppers.length * 2; step++) lines.push("every kind, " + steppers[step % steppers.length](long, step));
}
// All of them are alive at once and take their steps in turn.
function stepGeneratorsSideBySide(): void {
  lines.push("== generators side by side");
  const alive = generators.map(([, make]) => make());
  for (let step = 0; step < 3; step++) {
    alive.forEach((generator, index) => lines.push(generators[index][0] + ", " + steppers[(index * 3 + step) % steppers.length](generator, step)));
    collect();
  }
}
async function stepsBehindAnAwait(generator: Texts, sent: number): Promise<string> {
  const a = draw(), b = draw(), c = draw() / 8, d = "d" + draw();
  await settled;
  const result = generator.next(sent);
  work(1);
  return "behind an await " + [a, b, c, d].join() + ": " + show(result);
}
async function stepGeneratorsFromJobs(): Promise<void> {
  lines.push("== generators stepped from jobs and timers");
  for (const [label, make] of generators) {
    const generator = make();
    lines.push(label + ", " + (await stepsBehindAnAwait(generator, 1)));
    lines.push(label + ", a then handler, " + (await settled.then(() => stepsBesideIntegers(generator, 2))));
    await afterTimer();
    lines.push(label + ", " + stepsBesideAMixture(generator, 3));
  }
}

async function quick(n: number): Promise<number> {
  return n + 1;
}
async function once(n: number): Promise<number> {
  await settled;
  return n + 1;
}
type Holder = (gate: Promise<number>) => Promise<string>;
async function holds1(gate: Promise<number>): Promise<string> { const a = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [a, s, t].join(); }
async function holds2(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, s, t].join(); }
async function holds3(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, c, s, t].join(); }
async function holds4(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, s, t].join(); }
async function holds5(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, e, s, t].join(); }
async function holds6(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, s, t].join(); }
async function holds7(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, g, s, t].join(); }
async function holds8(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, h, g, s, t].join(); }
async function holds10(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(), i = draw(), j = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, h, g, j, i, s, t].join(); }
async function holds14(gate: Promise<number>): Promise<string> { const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(), i = draw(), j = draw(), k = draw(), l = draw(), m = draw(), n = draw(); work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, h, g, j, i, l, k, n, m, s, t].join(); }
async function holdsFractions3(gate: Promise<number>): Promise<string> { const a = draw() / 8, b = draw() / 8, c = draw() / 8; work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, c, s, t].join(); }
async function holdsFractions10(gate: Promise<number>): Promise<string> { const a = draw() / 8, b = draw() / 8, c = draw() / 8, d = draw() / 8, e = draw() / 8, f = draw() / 8, g = draw() / 8, h = draw() / 8, i = draw() / 8, j = draw() / 8; work(1); const s = await gate; work(1); const t = await gate; work(1); return [b, a, d, c, f, e, h, g, j, i, s, t].join(); }
async function holdsCells(gate: Promise<number>): Promise<string> {
  const a = "a" + draw(), b = { n: draw() }, c = [draw(), draw()], d = new Point(draw(), draw()), e = BigInt(draw()), f = Symbol("f" + draw());
  work(1);
  const s = await gate;
  work(1);
  const t = await gate;
  work(1);
  return [b.n, a, d.x, c.join("+"), e, d.y, f.description, s, t].join();
}
const holders: [label: string, hold: Holder][] = [
  ["1 integer", holds1],
  ["2 integers", holds2],
  ["3 integers", holds3],
  ["4 integers", holds4],
  ["5 integers", holds5],
  ["6 integers", holds6],
  ["7 integers", holds7],
  ["8 integers", holds8],
  ["10 integers", holds10],
  ["14 integers", holds14],
  ["3 fractions", holdsFractions3],
  ["10 fractions", holdsFractions10],
  ["cells", holdsCells],
];

function drainsBesideIntegers(): string {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw();
  drain();
  return "integers " + [a, b, c, d, e, f, g, h].join();
}
function drainsBesideFractions(): string {
  const a = draw() / 8, b = draw() / 8, c = draw() / 8, d = draw() / 8, e = draw() / 8, f = draw() / 8, g = draw() / 8, h = draw() / 8, i = draw() / 8, j = draw() / 8;
  drain();
  return "fractions " + [a, b, c, d, e, f, g, h, i, j].join();
}
function drainsBesideCells(): string {
  const a = "a" + draw(), b = { n: draw() }, c = [draw()], d = new Point(draw(), draw()), e = BigInt(draw()), f = Symbol("f" + draw());
  drain();
  return "cells " + [a, b.n, c[0], d.x, d.y, e, f.description].join();
}
const drainers: (() => string)[] = [drainsBesideIntegers, drainsBesideFractions, drainsBesideCells];

// The function that waits holds values too, and goes on as soon as the one below has returned.
async function waitsBeside2(hold: Holder, gate: Promise<number>): Promise<string> {
  const a = draw(), b = draw();
  work(1);
  const below = await hold(gate);
  work(1);
  return [b, a].join() + " < " + below;
}
async function waitsFor3Beside5(gate: Promise<number>): Promise<string> {
  const a = draw(), b = draw(), c = draw(), d = draw() / 8, e = "e" + draw();
  work(1);
  const below = await holds3(gate);
  work(1);
  return [e, d, c, b, a].join() + " < " + below;
}
async function waitsFor5Beside9(gate: Promise<number>): Promise<string> {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw(), i = draw();
  work(1);
  const below = await waitsFor3Beside5(gate);
  work(1);
  return [i, h, g, f, e, d, c, b, a].join() + " < " + below;
}
async function waitsFor9Beside1(gate: Promise<number>): Promise<string> {
  const a = draw();
  work(1);
  const below = await waitsFor5Beside9(gate);
  work(1);
  return a + " < " + below;
}

async function resumeAsyncFunctions(): Promise<void> {
  lines.push("== async functions resumed from the event loop");
  for (const [label, hold] of holders) {
    const gate = makeGate();
    const result = hold(gate.promise);
    setTimeout(() => gate.open(draw()), 0);
    lines.push(label + ": " + (await result));
  }
  lines.push("== async functions that find the promise fulfilled");
  for (const [label, hold] of holders) lines.push(label + ": " + (await hold(Promise.resolve(draw()))));
  lines.push("== async functions resumed from a drain in a function that holds values");
  let turn = 0;
  for (const [label, hold] of holders) {
    for (let round = 0; round < 2; round++) {
      const gate = makeGate();
      const result = hold(gate.promise);
      gate.open(draw());
      lines.push(label + ", drained beside " + drainers[turn++ % drainers.length]());
      lines.push(label + ": " + (await result));
    }
  }
  lines.push("== async functions resumed by the end of the function that they wait for");
  for (const [label, hold] of holders) {
    const gate = makeGate();
    const result = waitsBeside2(hold, gate.promise);
    setTimeout(() => gate.open(draw()), 0);
    lines.push(label + ": " + (await result));
  }
  for (const way of ["the event loop", "a drain"]) {
    const gate = makeGate();
    const result = waitsFor9Beside1(gate.promise);
    if (way === "a drain") {
      gate.open(draw());
      lines.push("a chain, drained beside " + drainsBesideIntegers());
    } else setTimeout(() => gate.open(draw()), 0);
    lines.push("a chain, " + way + ": " + (await result));
  }
  lines.push("== async functions resumed in a row");
  for (const way of ["the event loop", "a drain", "the event loop, after a collection"]) {
    const gate = makeGate();
    const results = holders.map(([, hold]) => hold(gate.promise));
    results.push(waitsFor9Beside1(gate.promise), waitsFor3Beside5(gate.promise));
    if (way === "a drain") {
      gate.open(draw());
      lines.push("drained beside " + drainsBesideFractions());
    } else {
      if (way !== "the event loop") collect();
      setTimeout(() => gate.open(draw()), 0);
    }
    for (const text of await Promise.all(results)) lines.push(way + ": " + text);
  }
}

async function holdsEveryKind(gates: Promise<number>[]): Promise<string[]> {
  let i = draw(), j = draw(), k = draw(), l = draw();
  let d = draw() / 8, e = draw() / 16;
  let s = "s" + draw();
  let b = draw() % 2 === 0;
  const o = { n: draw() };
  const p = new Point(draw(), draw());
  const a = [draw(), draw()];
  let g = BigInt(draw());
  const y = Symbol("y" + draw());
  const c = draw();
  const f = (): number => c + 1;
  let u: number | undefined = draw() % 2 ? draw() : undefined;
  let x: any = draw() % 2 ? "x" + draw() : draw();
  const out: string[] = [];
  for (let round = 0; round < gates.length; round++) {
    i += work(1);
    d += work(2) / 4;
    out.push([i, j, k, l, d, e, s, b, o.n, p.x, p.y, a.join("+"), g, y.description, f(), u, x].join(" "));
    let sent: number;
    switch (round % 4) {
      case 0:
        sent = await gates[round];
        break;
      case 1:
        sent = await round;
        break;
      case 2:
        sent = await quick(round);
        break;
      default:
        sent = await once(round);
    }
    work(1);
    j += sent;
    k = (k + j) % 1009;
    l ^= k;
    e += d / 2;
    s += sent;
    b = !b;
    o.n += sent;
    p.x += p.y;
    a.push(sent);
    g += BigInt(sent);
    u = u === undefined ? sent : undefined;
    x = typeof x === "string" ? x.length : "x" + x;
  }
  out.push([x, u, f(), y.description, g, a.join("+"), p.y, p.x, o.n, b, s, e, d, l, k, j, i].join(" "));
  return out;
}
async function resumeEveryKind(): Promise<void> {
  lines.push("== every kind across awaits");
  const first = makeGate(), second = makeGate(), third = makeGate();
  const unused = Promise.resolve(0);
  const result = holdsEveryKind([first.promise, unused, unused, unused, second.promise, unused, unused, unused, third.promise]);
  setTimeout(() => first.open(11), 0);
  await afterTimer();
  await afterTimer();
  collect();
  second.open(22);
  lines.push("drained beside " + drainsBesideCells());
  collect();
  void settled.then(() => third.open(33));
  for (const text of await result) lines.push(text);
}

async function* produces(count: number): AsyncGenerator<string, void, unknown> {
  let a = draw(), b = draw(), c = draw(), d = draw() / 8, e = "e" + draw();
  const f = { n: draw() };
  for (let round = 0; round < count; round++) {
    work(1);
    yield [a, b, c, d, e, f.n].join();
    work(1);
    a += b;
    b ^= c;
    c = (c + a) % 1009;
    d += 0.125;
    e += round;
    f.n++;
    if (round % 3 === 2) await null;
  }
}
async function* relays(count: number): AsyncGenerator<string, void, unknown> {
  let a = draw(), b = draw(), c = draw() / 8;
  const d = [draw()];
  for await (const text of produces(count)) {
    work(1);
    yield [a, b, c, d[0]].join() + " relays " + text;
    work(1);
    a ^= b;
    b += 3;
    c += 0.5;
    d[0]++;
  }
}
async function consumes(label: string, stream: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  let a = draw(), b = draw(), c = draw(), d = draw(), e = draw() / 8, f = draw() / 8, g = "g" + draw();
  const h = new Point(draw(), draw());
  const out: string[] = [];
  for await (const text of stream) {
    work(1);
    out.push(label + " " + [a, b, c, d, e, f, g, h.x, h.y].join() + " got " + text);
    a ^= b;
    b += c;
    c = (c + d) % 1009;
    d += 1;
    e += f;
    f /= 2;
    g += "!";
    h.x += h.y;
  }
  out.push(label + " " + [h.y, h.x, g, f, e, d, c, b, a].join() + " is over");
  return out;
}
function asksBesideIntegers(stream: AsyncGenerator<string, void, unknown>): [beside: string, step: Promise<IteratorResult<string, void>>] {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw(), g = draw(), h = draw();
  const step = stream.next();
  return [[a, b, c, d, e, f, g, h].join(), step];
}
function asksBesideFractions(stream: AsyncGenerator<string, void, unknown>): [beside: string, step: Promise<IteratorResult<string, void>>] {
  const a = draw() / 8, b = draw() / 8, c = draw() / 8, d = draw() / 8, e = draw() / 8, f = draw() / 8, g = draw() / 8, h = draw() / 8, i = draw() / 8;
  const step = stream.next();
  return [[a, b, c, d, e, f, g, h, i].join(), step];
}
async function runStreams(): Promise<void> {
  lines.push("== streams");
  for (const text of await consumes("alone", produces(7))) lines.push(text);
  for (const text of await consumes("behind a relay", relays(5))) lines.push(text);
  for (const texts of await Promise.all([consumes("left", produces(5)), consumes("right", relays(4)), consumes("third", produces(3))])) for (const text of texts) lines.push(text);
  const asked = produces(4);
  for (let round = 0; round < 6; round++) {
    const [beside, step] = round % 2 ? asksBesideFractions(asked) : asksBesideIntegers(asked);
    const result = await step;
    lines.push("asked beside " + beside + ": " + (result.done ? "over" : result.value));
  }
}

// Thirteen numbers and a depth: more than the registers for arguments hold.
function spreadsOut(depth: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number): number {
  if (depth) return spreadsOut(depth - 1, b, c, d, e, f, g, h, i, j, k, l, m, a) + 1;
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j + 11 * k + 12 * l + 13 * m;
}
function* passesManyArguments(): Generator<number, number, number> {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw();
  let sum = spreadsOut(2, a, b, c, d, e, f, 1, 2, 3, 4, 5, 6, 7);
  const s = yield sum;
  sum += spreadsOut(1, s, f, e, d, c, b, a, 7, 6, 5, 4, 3, 2);
  const t = yield sum;
  sum += spreadsOut(3, t, s, a, c, e, b, d, f, 9, 8, 7, 6, 5);
  return sum;
}
async function passesManyArgumentsBetweenAwaits(gate: Promise<number>): Promise<number> {
  const a = draw(), b = draw(), c = draw(), d = draw(), e = draw(), f = draw();
  let sum = spreadsOut(2, a, b, c, d, e, f, 1, 2, 3, 4, 5, 6, 7);
  const s = await gate;
  sum += spreadsOut(1, s, f, e, d, c, b, a, 7, 6, 5, 4, 3, 2);
  const t = await once(s);
  sum += spreadsOut(3, t, s, a, c, e, b, d, f, 9, 8, 7, 6, 5);
  const u = await 5;
  return sum + spreadsOut(0, u, t, s, f, e, d, c, b, a, 1, 1, 1, 1);
}
function* takesManyParameters(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): Texts {
  work(1);
  const s = yield [a, b, c, d, e, f, g, h, i, j, k, l, m, n].join();
  work(1);
  const t = yield [n, m, l, k, j, i, h, g, f, e, d, c, b, a, s].join();
  return [b, a, d, c, f, e, h, g, j, i, l, k, n, m, s, t].join();
}
async function takesManyParametersAndWaits(gate: Promise<number>, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): Promise<string> {
  work(1);
  const s = await gate;
  work(1);
  const t = await once(s);
  return [b, a, d, c, f, e, h, g, j, i, l, k, n, m, s, t].join();
}
async function runManyArguments(): Promise<void> {
  lines.push("== more arguments than registers");
  for (let round = 0; round < 3; round++) {
    const generator = passesManyArguments();
    lines.push("a generator: " + [generator.next(0).value, generator.next(draw()).value, generator.next(draw()).value].join());
    const gate = makeGate();
    const result = passesManyArgumentsBetweenAwaits(gate.promise);
    if (round === 1) {
      gate.open(draw());
      lines.push("drained beside " + drainsBesideIntegers());
    } else setTimeout(() => gate.open(draw()), 0);
    lines.push("an async function: " + (await result));
    const taker = takesManyParameters(draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw());
    lines.push("a generator with 14 parameters, " + stepsBesideIntegers(taker, 1));
    lines.push("a generator with 14 parameters, " + stepsInACallback(taker, 2));
    lines.push("a generator with 14 parameters, " + stepsBesideCells(taker, 3));
    const other = makeGate();
    const waiting = takesManyParametersAndWaits(other.promise, draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw(), draw());
    setTimeout(() => other.open(draw()), 0);
    lines.push("an async function with 15 parameters: " + (await waiting));
  }
}

function churn(): number {
  let total = 0;
  for (let i = 0; i < 20_000; i++) total += ("garbage " + i).length + [i, i + 1].length + new Point(i, i).x;
  return total;
}
function hashOf(texts: string[]): number {
  let hash = 0;
  for (const text of texts) for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}
async function collectWhileSuspended(): Promise<void> {
  lines.push("== collections while only the suspended frames hold the objects");
  const suspended: Texts[] = [];
  const texts: string[] = [];
  for (let n = 0; n < 300; n++) {
    const generator = n % 3 === 0 ? keepsCells() : n % 3 === 1 ? keepsEveryKind(2) : keeps14();
    texts.push(generator.next(0).value);
    suspended.push(generator);
  }
  const gate = makeGate();
  const waiting: Promise<string>[] = [];
  for (let n = 0; n < 300; n++) waiting.push(n % 3 === 0 ? holdsCells(gate.promise) : n % 3 === 1 ? waitsFor3Beside5(gate.promise) : holds14(gate.promise));
  collect();
  lines.push("garbage " + churn());
  collect();
  for (const generator of suspended) texts.push(generator.next(1).value);
  collect();
  lines.push("garbage " + churn());
  for (const generator of suspended) texts.push(generator.next(2).value);
  lines.push(texts.length + " texts of generators, the last " + texts[texts.length - 1] + ", hash " + hashOf(texts));
  setTimeout(() => gate.open(7), 0);
  const results = await Promise.all(waiting);
  lines.push(results.length + " texts of async functions, the last " + results[results.length - 1] + ", hash " + hashOf(results));
}

stepGenerators();
stepGeneratorsSideBySide();
await stepGeneratorsFromJobs();
await resumeAsyncFunctions();
await resumeEveryKind();
await runStreams();
await runManyArguments();
await collectWhileSuspended();
lines.push("calls of work " + worked + ", the last number " + draw());
console.log(lines.join("\n"));

export {};
