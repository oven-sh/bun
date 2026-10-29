// A call of a generator function makes the generator and saves the frame of its body for the first time. From the second call of a function object on, neither enters the runtime, however the
// function is written and whatever it takes. The generator inherits from what the function's `prototype` holds at that moment: another object, an object of another realm, or, for null, 1 and
// any other primitive, the realm's own generator prototype. That holds after every way to store to `prototype`, for generator functions of another realm and for 48 closures called in turn.
// The program counts the entries of the two operations, which only the jsc shell can.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
declare const gc: undefined | (() => void);
declare const createGlobalObject: undefined | (() => any);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
const otherRealm: any = typeof createGlobalObject === "function" ? createGlobalObject() : require("node:vm").runInNewContext("globalThis");
function entered(): number {
  return counted ? counted("operationAOTNewGenerator") + counted("operationAOTSaveFrameAndYield") : 0;
}
function few(entries: number, calls: number): string {
  return entries * 20 < calls ? "few entries" : entries + " ENTRIES FOR " + calls + " CALLS";
}
const lines: string[] = [];
let finished = 0;
type Numbers = Generator<number, void, unknown>;
type NumbersLater = AsyncGenerator<number, void, unknown>;

function* declared(n: number): Numbers {
  yield n;
  yield n + 1;
}
const expression = function* (n: number): Numbers {
  yield n;
};
class Holder {
  constructor(readonly base: number) {}
  *method(n: number): Numbers {
    yield this.base + n;
  }
  static *fixed(n: number): Numbers {
    yield n * 2;
  }
  *[Symbol.iterator](): Numbers {
    yield this.base;
  }
  async *later(n: number): NumbersLater {
    yield this.base + n;
  }
  static async *fixedLater(n: number): NumbersLater {
    yield n * 2;
  }
}
const holder = new Holder(10);
const literal = {
  *member(n: number): Numbers {
    yield n + 1;
  },
  async *memberLater(n: number): NumbersLater {
    yield n + 1;
  },
};
function makes(offset: number): (n: number) => Numbers {
  return function* (n: number): Numbers {
    yield n + offset;
  };
}
function makesLater(offset: number): (n: number) => NumbersLater {
  return async function* (n: number): NumbersLater {
    yield n + offset;
  };
}
function* takesNothing(): Numbers {
  yield 1;
}
function* takesAPattern({ n, m }: { n: number; m: number }): Numbers {
  yield n + m;
}
function* takesADefault(n: number, step: number = 2): Numbers {
  yield n + step;
}
function* takesARest(...all: number[]): Numbers {
  yield all.length;
}
function* takesMany(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): Numbers {
  yield a + b + c + d + e + f + g + h + i + j + k + l;
}
function* takesOtherKinds(text: string, fraction: number, flag: boolean, list: number[], record: { n: number }): Numbers {
  yield text.length + fraction * 2 + (flag ? 1 : 0) + list.length + record.n;
}
function* readsArguments(n: number): Numbers {
  yield arguments.length + n;
}
function* hasManyVariables(n: number): Numbers {
  let a = n, b = a + 1, c = b + 1, d = c + 1, e = d + 1, f = e + 1, g = f + 1, h = g + 1, i = h + 1, j = i + 1, k = j + 1, l = k + 1, m = l + 1, o = m + 1, p = o + 1, q = p + 1;
  for (;;) {
    yield a + b + c + d + e + f + g + h + i + j + k + l + m + o + p + q;
    a += q; b += a; c += b; d += c; e += d; f += e; g += f; h += g; i += h; j += i; k += j; l += k; m += l; o += m; p += o; q = (q + p) % 97;
  }
}
function* hasAFinally(n: number): Numbers {
  try {
    yield n;
  } finally {
    finished++;
  }
}
function* delegates(n: number): Numbers {
  yield* declared(n);
}
function* closesOverItsParameter(n: number): Numbers {
  const read = (): number => n;
  yield read();
}
async function* declaredLater(n: number): NumbersLater {
  yield n;
  yield n + 1;
}
const expressionLater = async function* (n: number): NumbersLater {
  yield n;
};
async function* takesAPatternLater({ n, m }: { n: number; m: number }): NumbersLater {
  yield n + m;
}
async function* takesARestLater(...all: number[]): NumbersLater {
  yield all.length;
}
async function* awaitsFirst(n: number): NumbersLater {
  yield (await n) + 1;
}

const calls = 4000;
function measure(label: string, make: (i: number) => Numbers): void {
  make(0).next();
  const before = entered();
  let sum = 0;
  const kept: Numbers[] = [];
  for (let i = 0; i < calls; i++) {
    const generator = make(i);
    if (i % 4) sum += generator.next().value as number;
    if (i % 500 === 0) kept.push(generator);
    if (i % 2000 === 1999) collect();
  }
  const entries = entered() - before;
  for (const generator of kept) sum += (generator.next().value as number) + (generator.return().done ? 1 : 0);
  lines.push(label + ": " + sum + ", " + few(entries, calls));
}
async function measureLater(label: string, make: (i: number) => NumbersLater): Promise<void> {
  await make(0).next();
  const before = entered();
  const steps: Promise<IteratorResult<number, void>>[] = [];
  for (let i = 0; i < calls; i++) {
    const generator = make(i);
    if (i % 4 === 1) steps.push(generator.next());
    if (i % 2000 === 1999) collect();
  }
  const entries = entered() - before;
  let sum = 0;
  for (const step of await Promise.all(steps)) sum += step.value as number;
  lines.push(label + ": " + sum + ", " + few(entries, calls));
}

const theirs: any = otherRealm.Function("return function* (n) { yield n; yield 'theirs'; }")();
const theirsLater: any = otherRealm.Function("return async function* (n) { yield n; yield 'theirs'; }")();
const generatorPrototype: any = Object.getPrototypeOf(declared.prototype);
const asyncGeneratorPrototype: any = Object.getPrototypeOf(declaredLater.prototype);
const theirGeneratorPrototype: any = Object.getPrototypeOf(theirs.prototype);
const theirAsyncGeneratorPrototype: any = Object.getPrototypeOf(theirsLater.prototype);

// intrinsic: what a generator of f inherits from while f.prototype holds no object. foreign: an object of the realm that is not f's.
async function changesOfPrototype(label: string, f: any, intrinsic: any, foreign: object): Promise<void> {
  const own: object = f.prototype;
  const other: object = Object.create(intrinsic);
  const bare: object = Object.create(null);
  const callable: object = () => 0;
  const named: [string, unknown][] = [
    ["its own", own],
    ["another", other],
    ["one without a prototype", bare],
    ["a function", callable],
    ["one of the other realm", foreign],
    ["the realm's", intrinsic],
  ];
  const whose = (generator: object): string => {
    const prototype: unknown = Object.getPrototypeOf(generator);
    for (const [name, candidate] of named) if (prototype === candidate) return name;
    return "UNKNOWN";
  };
  const firstOf = async (generator: object): Promise<unknown> => (await intrinsic.next.call(generator)).value;
  const early: object = f(1);
  lines.push(label + ", at first: " + whose(early) + ", " + whose(f(2)) + ", " + (early instanceof f));
  const stores: [string, unknown][] = [
    ["another", other],
    ["null", null],
    ["its own", own],
    ["1", 1],
    ["another", other],
    ["undefined", undefined],
    ["a string", "text"],
    ["one without a prototype", bare],
    ["a symbol", Symbol.iterator],
    ["one of the other realm", foreign],
    ["true", true],
    ["a function", callable],
    ["a bigint", 1n],
    ["the realm's", intrinsic],
    ["its own", own],
  ];
  for (const [name, value] of stores) {
    f.prototype = value;
    const made: object[] = [f(3), f(4), f(5)];
    lines.push(label + ", prototype = " + name + ": " + made.map(whose).join(", ") + ", yields " + (await firstOf(made[1])));
  }
  let right = 0;
  for (let i = 0; i < 3000; i++) {
    const wanted = i % 3 === 0 ? own : i % 3 === 1 ? other : null;
    f.prototype = wanted;
    if (Object.getPrototypeOf(f(i)) === (wanted ?? intrinsic)) right++;
  }
  lines.push(label + ", a store before every call: " + right + " of 3000 right");
  right = 0;
  for (let block = 0; block < 40; block++) {
    f.prototype = block % 4 === 3 ? 0 : block % 2 ? other : own;
    if (block % 10 === 5) collect();
    const wanted: unknown = block % 4 === 3 ? intrinsic : f.prototype;
    for (let i = 0; i < 50; i++) if (Object.getPrototypeOf(f(i)) === wanted) right++;
  }
  lines.push(label + ", a store before every fifty calls: " + right + " of 2000 right");
  const key = ["proto", "type"].join("");
  const ways: [string, () => unknown][] = [
    ["defineProperty", () => Object.defineProperty(f, "prototype", { value: other })],
    ["Reflect.set", () => Reflect.set(f, "prototype", own)],
    ["Reflect.defineProperty", () => Reflect.defineProperty(f, "prototype", { value: bare })],
    ["Object.assign", () => Object.assign(f, { prototype: own })],
    ["a computed name", () => (f[key] = other)],
    ["defineProperties", () => Object.defineProperties(f, { prototype: { value: null } })],
    ["a store through an heir, which leaves it alone", () => (Object.create(f).prototype = bare)],
    ["delete, which fails", () => Reflect.deleteProperty(f, "prototype")],
    ["a computed name again", () => (f[key] = own)],
  ];
  for (const [name, store] of ways) {
    f(6);
    store();
    lines.push(label + ", by " + name + ": " + whose(f(7)) + ", " + whose(f(8)));
  }
  Object.setPrototypeOf(own, other);
  const late: object = f(9);
  lines.push(label + ", its own prototype inherits from another: " + whose(late) + ", " + (Object.getPrototypeOf(Object.getPrototypeOf(late)) === other) + ", " + (late instanceof f) + ", yields " + (await firstOf(late)));
  Object.setPrototypeOf(own, intrinsic);
  lines.push(label + ", the first one still: " + whose(early) + ", yields " + (await firstOf(early)));
  Object.defineProperty(f, "prototype", { writable: false });
  let refusal = "no error";
  try {
    f.prototype = other;
  } catch (error) {
    refusal = (error as Error).name;
  }
  lines.push(label + ", a store to a read-only prototype: " + refusal + ", " + whose(f(10)) + ", " + whose(f(11)));
}

function* changed(n: number): Numbers {
  yield n;
}
async function* changedLater(n: number): NumbersLater {
  yield n;
}
class Changed {
  *method(n: number): Numbers {
    yield n;
  }
}
// The parameters are evaluated before the generator gets its prototype.
function* storesInItsHead(to: unknown, stored: unknown = ((storesInItsHead as any).prototype = to)): Generator<unknown, void, unknown> {
  yield stored;
}
async function* storesInItsHeadLater(to: unknown, stored: unknown = ((storesInItsHeadLater as any).prototype = to)): AsyncGenerator<unknown, void, unknown> {
  yield stored;
}
function storesInHeads(): void {
  const first: object = Object.create(generatorPrototype);
  const second: object = Object.create(generatorPrototype);
  const results: boolean[] = [];
  for (const to of [first, second, second, first, null, first, 1, second]) results.push(Object.getPrototypeOf(storesInItsHead(to)) === (typeof to === "object" && to ? to : generatorPrototype));
  lines.push("a store in the head of the function: " + results.join(" "));
  const later: boolean[] = [];
  for (const to of [first, second, second, first, null, first, 1, second]) later.push(Object.getPrototypeOf(storesInItsHeadLater(to)) === (typeof to === "object" && to ? to : asyncGeneratorPrototype));
  lines.push("a store in the head of the async function: " + later.join(" "));
}

function closuresInTurn(): void {
  const all: ((n: number) => Numbers)[] = [];
  for (let i = 0; i < 48; i++) all.push(makes(i));
  let sum = 0;
  let right = 0;
  for (let turn = 0; turn < 200; turn++) {
    for (const make of all) {
      const generator = make(turn);
      sum += generator.next().value as number;
      if (Object.getPrototypeOf(generator) === make.prototype) right++;
    }
    if (turn === 100) {
      collect();
      for (let i = 0; i < 48; i += 5) (all[i] as any).prototype = i % 2 ? null : all[(i + 1) % 48].prototype;
    }
  }
  lines.push("48 closures in turn: " + sum + ", " + right + " inherit from what their function holds, prototypes of their own: " + (new Set(all.map(make => make.prototype)).size));
  let fresh = 0;
  for (let i = 0; i < 2000; i++) {
    const make = makes(i);
    const generator = make(1);
    fresh += (generator.next().value as number) + (Object.getPrototypeOf(generator) === make.prototype ? 1 : 0);
  }
  lines.push("2000 closures called once: " + fresh);
}

function acrossRealms(): void {
  const ours = makes(5) as any;
  ours.prototype = theirs.prototype;
  const mixed = ours(1);
  lines.push("ours with their prototype: " + (Object.getPrototypeOf(mixed) === theirs.prototype) + ", " + [...mixed].join() + ", " + (mixed instanceof theirs) + ", " + (mixed instanceof ours));
  theirs.prototype = declared.prototype;
  const mixedToo = theirs(2);
  lines.push("theirs with our prototype: " + (Object.getPrototypeOf(mixedToo) === declared.prototype) + ", " + [...mixedToo].join() + ", " + (mixedToo instanceof declared));
  let sum = 0;
  for (let i = 0; i < 2000; i++) for (const value of theirs(i)) if (typeof value === "number") sum += value;
  lines.push("theirs in a loop of ours: " + sum);
  lines.push("ours in a loop of theirs: " + otherRealm.Function("make", "let sum = 0; for (let i = 0; i < 2000; i++) for (const value of make(i)) sum += value; return sum;")(declared));
}

lines.push("== counts");
measure("declared", i => declared(i));
measure("a function expression", i => expression(i));
measure("a method", i => holder.method(i));
measure("a static method", i => Holder.fixed(i));
measure("Symbol.iterator", () => holder[Symbol.iterator]());
measure("a member of a literal", i => literal.member(i));
const closure = makes(100);
measure("a closure", i => closure(i));
measure("takes nothing", () => takesNothing());
measure("takes a pattern", i => takesAPattern({ n: i, m: 1 }));
measure("takes a default", i => takesADefault(i));
measure("takes a rest", i => takesARest(i, i, i));
measure("takes many", i => takesMany(i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
measure("takes other kinds", i => takesOtherKinds("text", i / 2, i % 2 === 0, [i], { n: i }));
measure("reads arguments", i => readsArguments(i));
measure("has many variables", i => hasManyVariables(i % 10));
measure("has a finally", i => hasAFinally(i));
measure("delegates", i => delegates(i));
measure("closes over its parameter", i => closesOverItsParameter(i));
await measureLater("async, declared", i => declaredLater(i));
await measureLater("async, a function expression", i => expressionLater(i));
await measureLater("async, a method", i => holder.later(i));
await measureLater("async, a static method", i => Holder.fixedLater(i));
await measureLater("async, a member of a literal", i => literal.memberLater(i));
const closureLater = makesLater(100);
await measureLater("async, a closure", i => closureLater(i));
await measureLater("async, takes a pattern", i => takesAPatternLater({ n: i, m: 1 }));
await measureLater("async, takes a rest", i => takesARestLater(i, i, i));
await measureLater("async, awaits first", i => awaitsFirst(i));
lines.push("finally blocks run: " + finished);
lines.push("== prototypes");
await changesOfPrototype("declared", changed, generatorPrototype, theirs.prototype);
await changesOfPrototype("a closure", makes(1), generatorPrototype, theirs.prototype);
await changesOfPrototype("a method", Changed.prototype.method, generatorPrototype, theirs.prototype);
await changesOfPrototype("async", changedLater, asyncGeneratorPrototype, theirsLater.prototype);
await changesOfPrototype("an async closure", makesLater(1), asyncGeneratorPrototype, theirsLater.prototype);
await changesOfPrototype("of another realm", otherRealm.Function("return function* (n) { yield n; }")(), theirGeneratorPrototype, declared.prototype);
await changesOfPrototype("async, of another realm", otherRealm.Function("return async function* (n) { yield n; }")(), theirAsyncGeneratorPrototype, declaredLater.prototype);
storesInHeads();
closuresInTurn();
acrossRealms();
measure("declared, after all that", i => declared(i));
console.log(lines.join("\n"));

export {};
