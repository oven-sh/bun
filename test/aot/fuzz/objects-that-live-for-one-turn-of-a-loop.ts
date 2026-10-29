// Objects, lists, instances, closures and the variables that closures share, made anew in each turn of a loop and used inside the function that makes them.
// A compiler may keep such a thing in one place that every turn fills again. Each turn still has its own, a thing kept from an earlier turn is still what it was, and nothing is read ahead of the turn that makes it.
//
//   made     a literal, a literal in a literal, a copy by spread, an instance, an instance of a subclass, a link of a chain, a list of numbers, fractions, objects or texts, a pair in a list,
//            a closure, a closure of a closure, closures that share a variable, an object with a getter, an object that can be walked: over a number of the turn or a variable of the turn that changes later
//   comes    at once, where two ways meet (`?:`, `if`, `switch`, `&&`, `??`, a default), out of a list by a constant or a variable index, out of an object, a Map, a pattern, a rest list,
//            handed back by a small function, by one that calls itself, by a closure, by a step of a generator; made by a closure that an earlier loop has put into a list;
//            set in a handler or ahead of a throw; from the turn before, or from the one before that
//   loop     counted up and down, for-of, for-in, entries, `while`, `do`, a loop in a loop with a label, forEach; `continue`, `break`, both with a label, a `return` from a callback
//   around   a handler or a `finally` in the turn or around the loop, a throw out of a callee, a stop at a `yield` or an `await`, the function calling itself in the middle of the turn
//   changed  a text made longer piece by piece, with a throw between two pieces; stores, `+=`, swaps, one more field, a deleted field, push, pop, a length, a store beyond the end, many elements more, a frozen object, a link to the thing of the turn before
//   read     fields, methods, elements, patterns, spreads, the names of the fields, JSON: there, in a closure called there, in a closure lent to a function, in a closure kept for later,
//            in a reader: a declared function, an arrow kept in a constant, a bound function, a method; reached by a call, `.call`, `.apply`, Reflect.apply or as the callback of a built-in
//   later    the thing of one turn, of the last turn and of the turn before it are read again behind the loop
import type { Random } from "./random";

type Kind = {
  type: string;
  make: (value: string) => string;
  reads: ((it: string, at: string) => string)[];
  changes: ((it: string, value: string) => string)[];
};

const prelude = `type Seen = (number | string | undefined)[];
type Pair = { n: number; m: number; extra?: number };
type Named = { n: number; t: string };
type Nest = { inner: { n: number }; n: number };
type Counter = { up: () => number; get: () => number };
type Written = { add: (more: string) => string; get: () => string };
class Box {
  constructor(public n: number) {}
  twice() {
    return this.n * 2;
  }
}
class Wide extends Box {
  constructor(
    n: number,
    readonly w: number,
  ) {
    super(n);
  }
  sum() {
    return this.n + this.w;
  }
}
class Label {
  constructor(public t: string) {}
  add(more: string) {
    this.t += more;
    return this;
  }
}
class Link {
  readonly n: number;
  next: Link | undefined = undefined;
  constructor(n: number) {
    this.n = n;
  }
}
function same<T>(it: T): T {
  return it;
}
function back<T>(it: T, depth: number): T {
  return depth > 0 ? back(it, depth - 1) : it;
}
function either<T>(first: T, second: T, takesFirst: boolean): T {
  return takesFirst ? first : second;
}
function called<T>(read: () => T, depth: number): T {
  return depth > 0 ? called(read, depth - 1) : read();
}
function* hand<T>(it: T): Generator<T, void, unknown> {
  yield it;
}
function* echo<T>(first: T): Generator<T, void, T> {
  let now = first;
  for (;;) now = yield now;
}
function drain<T>(steps: Generator<unknown, T, unknown>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
function fails(when: boolean): void {
  if (when) throw new Error("stop");
}
function count(...all: number[]): number {
  return all.length * 100 + (all[0] ?? 0);
}
function sumOfPair(pair: Pair, depth: number): number {
  return depth > 0 ? sumOfPair(pair, depth - 1) + 1 : pair.n + pair.m;
}
function sumOfList(list: number[], depth: number): number {
  return depth > 0 ? sumOfList(list, depth - 1) + list.length : (list[0] ?? 0);
}
function bump(pair: Pair): void {
  pair.n += 100;
}`;

const numbers: Pick<Kind, "reads" | "changes"> = {
  reads: [
    it => `${it}[0]`,
    (it, at) => `${it}[${at} % 3]`,
    it => `${it}.length`,
    it => `${it}.at(-1)`,
    it => `${it}.reduce((sum, each) => sum + each, 0)`,
    it => `${it}.join("+")`,
    it => `sumOfList(${it}, 2)`,
    it => `(([first, , third]: number[]) => first * 10 + third)(${it})`,
    it => `Math.max(...${it})`,
    it => `count(...${it})`,
    it => `JSON.stringify(${it})`,
    it => `[...${it}, 1].length`,
  ],
  changes: [
    (it, value) => `${it}[1] = ${value};`,
    (it, value) => `${it}.push(${value});`,
    it => `${it}.length = 2;`,
    it => `${it}[0] += 0.5;`,
    it => `${it}.reverse();`,
    it => `${it}.pop();`,
    (it, value) => `${it}.push(${value}, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);`,
    (it, value) => `${it}[${it}.length] = ${value};`,
    (it, value) => `${it}[${it}.length + 2] = ${value};`,
    it => `${it}.shift();`,
  ],
};

/** A text that the thing holds, made longer piece by piece. `place` is where it is held. */
const texts = {
  reads: [
    (place: string) => `${place}.length`,
    (place: string) => `${place}.at(-1)`,
    (place: string) => `${place}.slice(-3)`,
    (place: string) => `${place}.charCodeAt(0)`,
    (place: string) => `${place}.split("t").length`,
    (place: string) => `(${place} + "").length`,
    (place: string) => `(${place} === "t1" ? "the first" : "another")`,
  ],
  changes: [
    (place: string) => `${place} += ${place};`,
    (place: string, value: string) => `${place} = ${place} + ${value};`,
    (place: string, value: string) => `${place} += String(${value});`,
    (place: string) => `${place} = \`<\${${place}}>\`;`,
    (place: string) => `for (let more = 0; more < 3; more++) ${place} += more;`,
    (place: string) => `${place} += "a";\n    fails(at === 1);\n    ${place} += "b";`,
    (place: string) => `${place} = ${place}.slice(1);`,
    (place: string) => `${place} += "x";\n    ${place} += "y";`,
  ],
};

const kinds: Kind[] = [
  {
    type: "Pair",
    make: value => `{ n: ${value}, m: ${value} + 1 }`,
    reads: [
      it => `${it}.n`,
      it => `${it}.n * 10 + ${it}.m`,
      it => `sumOfPair(${it}, 2)`,
      it => `Object.keys(${it}).join()`,
      it => `JSON.stringify(${it})`,
      it => `(({ n, m }: Pair) => n - m * 2)(${it})`,
      (it, at) => `${it}[${at} % 2 ? "n" : "m"]`,
      it => `count(${it}.n, ${it}.m)`,
      it => `(${it}.extra ?? -1)`,
    ],
    changes: [
      (it, value) => `${it}.n += ${value};`,
      it => `${it}.m = ${it}.n;`,
      it => `[${it}.n, ${it}.m] = [${it}.m, ${it}.n];`,
      it => `bump(${it});`,
      (it, value) => `${it}.extra = ${value};`,
      it => `delete ${it}.extra;`,
      (it, value) => `Object.assign(${it}, { m: ${value} });`,
      it => `${it}.n += 0.5;`,
      it => `Object.freeze(${it});`,
    ],
  },
  {
    type: "Pair",
    make: value => `{ ...other, n: ${value} }`,
    reads: [it => `${it}.n * 10 + ${it}.m`, it => `JSON.stringify(${it})`, it => `sumOfPair(${it}, 1)`],
    changes: [it => `${it}.m++;`, (it, value) => `${it}.extra = ${value};`],
  },
  {
    type: "Named",
    make: value => `{ n: ${value}, t: "t" + ${value} }`,
    reads: [it => `${it}.t`, it => `${it}.t.length + ${it}.n`, it => `\`\${${it}.t}:\${${it}.n}\``, it => `(({ t }: Named) => t)(${it})`, ...texts.reads.map(read => (it: string) => read(`${it}.t`))],
    changes: [it => `${it}.t += "x";`, it => `${it}.n = ${it}.t.length;`, it => `${it}.t += ${it}.n;`, ...texts.changes.map(change => (it: string, value: string) => change(`${it}.t`, value))],
  },
  {
    type: "Label",
    make: value => `new Label("l" + ${value})`,
    reads: [it => `${it}.t`, it => `${it}.add("!").t`, ...texts.reads.map(read => (it: string) => read(`${it}.t`))],
    changes: [it => `${it}.add("x");`, it => `${it}.add("a").add("b");`, ...texts.changes.map(change => (it: string, value: string) => change(`${it}.t`, value))],
  },
  {
    type: "Written",
    make: value => `(() => {\n      let written = "s" + ${value};\n      return { add: (more: string) => (written += more), get: () => written };\n    })()`,
    reads: [it => `${it}.get()`, it => `${it}.add("!")`, it => `${it}.get().length`, it => `called(${it}.get, 2)`],
    changes: [it => `${it}.add("x");`, it => `for (let more = 0; more < 3; more++) ${it}.add(String(more));`, it => `${it}.add("a");\n    fails(at === 1);\n    ${it}.add("b");`, it => `${it}.add(${it}.get());`],
  },
  {
    type: "string[]",
    make: value => `["a" + ${value}]`,
    reads: [it => `${it}[0]`, it => `${it}.join("|")`, ...texts.reads.map(read => (it: string) => read(`${it}[0]`))],
    changes: [it => `${it}.push(${it}.join("-"));`, it => `${it}[${it}.length - 1] += "z";`, ...texts.changes.map(change => (it: string, value: string) => change(`${it}[0]`, value))],
  },
  {
    type: "Nest",
    make: value => `{ inner: { n: ${value} }, n: 1 }`,
    reads: [it => `${it}.inner.n`, it => `same(${it}.inner).n`, it => `back(${it}, 2).inner.n`, it => `JSON.stringify(${it})`, it => `(({ inner: { n } }: Nest) => n)(${it})`],
    changes: [(it, value) => `${it}.inner = { n: ${value} + 5 };`, it => `${it}.inner.n++;`, it => `${it}.n = ${it}.inner.n;`],
  },
  {
    type: "Box",
    make: value => `new Box(${value})`,
    reads: [it => `${it}.n`, it => `${it}.twice()`, it => `(${it} instanceof Wide ? -1 : ${it}.n)`, it => `back(${it}, 1).twice()`],
    changes: [it => `${it}.n -= 1;`, it => `${it}.n = ${it}.twice();`],
  },
  {
    type: "Wide",
    make: value => `new Wide(${value}, ${value} * 2)`,
    reads: [it => `${it}.sum()`, it => `${it}.w`, it => `${it}.twice()`, it => `JSON.stringify(${it})`],
    changes: [it => `${it}.n += ${it}.w;`],
  },
  {
    type: "Link",
    make: value => `new Link(${value})`,
    reads: [it => `${it}.n`, it => `(${it}.next?.n ?? -1)`, it => `(${it}.next?.next?.n ?? -1)`, it => `(${it}.next === ${it} ? "itself" : "another")`],
    changes: [(it, value) => `${it}.next = new Link(${value} + 1);`, it => `${it}.next = other;`, it => `${it}.next = previous;`, it => `if (${it} !== previous) ${it}.next = previous;`],
  },
  { type: "number[]", make: value => `[${value}, ${value} + 1, ${value} + 2]`, ...numbers },
  { type: "number[]", make: value => `[${value} + 0.5, ${value}, 2]`, ...numbers },
  { type: "number[]", make: value => `[${value}]`, ...numbers },
  { type: "number[]", make: value => `[...given, ${value}]`, ...numbers },
  {
    type: "{ n: number }[]",
    make: value => `[{ n: ${value} }, { n: ${value} + 1 }]`,
    reads: [(it, at) => `${it}[${at} % 2].n`, it => `${it}.map(each => each.n).join()`, it => `${it}[0].n * 10 + ${it}[1].n`, it => `(${it}[0] === ${it}[1] ? "one" : "two")`],
    changes: [it => `${it}[0] = ${it}[1];`, it => `${it}[1].n++;`, it => `${it}.reverse();`, (it, value) => `${it}.push({ n: ${value} });`],
  },
  {
    type: "string[]",
    make: value => `["a" + ${value}, "b"]`,
    reads: [it => `${it}[0]`, it => `${it}.join("")`, (it, at) => `${it}[${at} % 2].length`],
    changes: [it => `${it}[1] += ${it}[0];`, it => `${it}.push("c");`],
  },
  {
    type: "[number, string]",
    make: value => `[${value}, "t" + ${value}] as [number, string]`,
    reads: [it => `${it}[1]`, it => `${it}[0]`, it => `${it}[1].length + ${it}[0]`, it => `(([n, t]: [number, string]) => t + n)(${it})`],
    changes: [it => `${it}[0]++;`, it => `${it}[1] += "y";`],
  },
  { type: "() => number", make: value => `() => ${value}`, reads: [it => `${it}()`, it => `same(${it})()`, it => `called(${it}, 2)`, it => `[1, 2].map(${it}).join()`], changes: [] },
  { type: "() => () => number", make: value => `() => () => ${value}`, reads: [it => `${it}()()`, it => `called(${it}(), 1)`, it => `called(${it}, 1)()`], changes: [] },
  { type: "() => string", make: value => `((text: string) => () => text)("t" + ${value})`, reads: [it => `${it}()`, it => `${it}().length`, it => `called(${it}, 2)`], changes: [] },
  { type: "() => { n: number }", make: value => `() => ({ n: ${value} })`, reads: [it => `${it}().n`, it => `called(${it}, 1).n`, it => `(${it}() === ${it}() ? "one" : "two")`], changes: [] },
  {
    type: "Counter",
    make: value => `(() => {\n      let held = ${value};\n      return { up: () => ++held, get: () => held };\n    })()`,
    reads: [it => `${it}.get()`, it => `(${it}.up(), ${it}.get())`, it => `called(${it}.up, 2)`],
    changes: [it => `${it}.up();`],
  },
  { type: "{ read: () => number; n: number }", make: value => `{ read: () => ${value}, n: ${value} }`, reads: [it => `${it}.read()`, it => `${it}.read() * 10 + ${it}.n`, it => `called(${it}.read, 1)`], changes: [it => `${it}.n++;`] },
  { type: "{ readonly n: number }", make: value => `{\n      get n() {\n        return ${value};\n      },\n    }`, reads: [it => `${it}.n`, it => `JSON.stringify(${it})`], changes: [] },
  { type: "Iterable<number>", make: value => `{\n      *[Symbol.iterator]() {\n        yield ${value};\n        yield ${value} + 1;\n      },\n    }`, reads: [it => `[...${it}].join()`, it => `Math.max(...${it})`], changes: [] },
  { type: "{ b: bigint }", make: value => `{ b: BigInt(${value}) * 10000000000000000000n }`, reads: [it => `String(${it}.b)`, it => `Number(${it}.b / 10000000000000000000n)`], changes: [it => `${it}.b += 1n;`] },
];

const lists = ["[3, 1, 4, 1, 5]", "[0, 1, 2]", "[7]", "([] as number[])", "[2, 1, 0, 1, 2, 3, 4, 5, 6]", "given", "[...given, 1]"];

type Loop = { open: string; close: string; isCallback?: boolean; label?: string };

function loopOf(random: Random): Loop {
  const n = random.pick([0, 1, 2, 3, 3, 4, 9]);
  const list = random.pick(lists);
  return random.pick<Loop>([
    { open: `for (let at = 0; at < ${n}; at++) {`, close: "}" },
    { open: `for (let at = 0; at < ${n}; at++) {`, close: "}" },
    { open: `for (let at = ${n}; at-- > 0; ) {`, close: "}" },
    { open: `for (const at of ${list}) {`, close: "}" },
    { open: `for (const [at] of ${list}.entries()) {`, close: "}" },
    { open: `let w = 0;\n  while (w < ${n}) {\n    const at = w++;`, close: "}" },
    { open: `let w = 0;\n  do {\n    const at = w;`, close: `} while (++w < ${n});` },
    { open: `for (const name in { a: 1, bc: 2, def: 3 }) {\n    const at = name.length;`, close: "}" },
    { open: `outer: for (let o = 0; o < 3; o++) {\n  for (let i = 0; i < ${n}; i++) {\n    const at = o * 2 + i;`, close: "}\n  }", label: "outer" },
    { open: `outer: for (const o of ${list}) {\n  let i = 0;\n  while (i < 2) {\n    const at = o + i++;`, close: "}\n  }", label: "outer" },
    { open: `${list}.forEach((_, at) => {`, close: "});", isCallback: true },
  ]);
}

/** Reads `it` in a function of its own, which is declared in front of the scenes. */
function reader(random: Random, kind: Kind, which: number, it: string, at: string, declarations: Map<string, string>): string {
  const type = kind.type;
  const name = `${random.pick(["read", "arrow", "bound", "readers.read", "Reads.read"])}${kinds.indexOf(kind)}x${which}`;
  const text = kind.reads[which]("it", "at");
  if (name.startsWith("readers.")) declarations.set(name, `  ${name.slice(8)}(it: ${type}, at: number) {\n    return ${text};\n  },`);
  else if (name.startsWith("Reads.")) declarations.set(name, `  static ${name.slice(6)}(it: ${type}, at: number) {\n    return ${text};\n  }`);
  else if (name.startsWith("read")) declarations.set(name, `function ${name}(it: ${type}, at: number) {\n  return ${text};\n}`);
  else if (name.startsWith("arrow")) declarations.set(name, `const ${name} = (it: ${type}, at: number) => ${text};`);
  else declarations.set(name, `const ${name} = function (this: unknown, it: ${type}, at: number) {\n  return ${text};\n}.bind(null);`);
  return random.pick([
    `${name}(${it}, ${at})`,
    `${name}(${it}, ${at})`,
    `${name}.call(undefined, ${it}, ${at})`,
    `${name}.apply(undefined, [${it}, ${at}])`,
    `Reflect.apply(${name}, undefined, [${it}, ${at}])`,
    `[${it}].map(${name})[0]`,
    `Array.from([${it}], ${name})[0]`,
  ]);
}

function scene(random: Random, index: number, turns: number, declarations: Map<string, string>, kind: Kind): string {
  const type = kind.type.includes("=>") ? `(${kind.type})` : kind.type;
  const form = random.weighted<string>([
    [6, "function"],
    [1, "arrow"],
    [1, "method"],
    [2, "generator"],
    [2, "async"],
    [2, "module"],
  ]);
  const loop = loopOf(random);
  const canStop = !loop.isCallback && (form === "generator" || form === "async");
  const pause = form === "generator" ? "yield at;" : "await at;";
  const self = form === "method" ? "this.run" : `scene${index}`;
  const again = form === "module" || (form === "async" && loop.isCallback) ? undefined : form === "async" ? `...(await ${self}(given, depth - 1))` : `...${self}(given, depth - 1)`;
  const usesOwn = random.chance(0.4);
  const number = () => random.pick(["at", "at", "at * 2 + 1", "(at + depth)", "given[at % given.length]", "(at | 0)"]);
  const value = usesOwn ? "own" : number();
  const fresh = () => `(${kind.make(value)})`;
  const another = () => `(${kind.make(`(${value} + 10)`)})`;
  /** Behind the loop there is no turn: `at` is a constant there. */
  const read = (it = "it", at = it === "it" ? "at" : "1"): string =>
    // A reader stands outside the scene: it sees nothing of `other`, `previous` or `given`.
    random.chance(0.3)
      ? reader(random, kind, random.below(kind.reads.length), it, at, declarations)
      : random.weighted<(text: string) => string>([
      [6, text => text],
      [1, text => `(() => ${text})()`],
      [1, text => `called(() => ${text}, 2)`],
      [1, text => `[0].map(() => ${text})[0]`],
      [1, text => `same(${text})`],
    ])(random.pick(kind.reads)(it, at));
  const stop = () => random.pick(loop.isCallback ? ["if (at === 1) return;"] : ["if (at === 1) continue;", "if (at === 2) break;", ...(loop.label ? [`if (at === 1) continue ${loop.label};`, `if (at === 3) break ${loop.label};`] : [])]);

  const arrival = random.pick<() => string>([
    () => `const it: ${type} = ${fresh()};`,
    () => `const it: ${type} = ${fresh()};`,
    () => `const it: ${type} = at < 1000 ? ${fresh()} : other;`,
    () => `const it: ${type} = at % 2 ? ${fresh()} : other;`,
    () => `const it: ${type} = at % 2 ? ${fresh()} : ${another()};`,
    () => `let it: ${type};\n    if (at % 3) it = ${fresh()};\n    else it = ${another()};`,
    () => `let it: ${type} = other;\n    if (at !== 1) it = ${fresh()};`,
    () => `const maybe: ${type} | undefined = at % 2 ? ${fresh()} : undefined;\n    const it: ${type} = maybe ?? other;`,
    () => `const it: ${type} = (at % 2 === 0 && ${fresh()}) || other;`,
    () => `let it: ${type} = other;\n    switch (at % 3) {\n      case 0:\n        it = ${fresh()};\n        break;\n      case 1:\n        it = ${another()};\n    }`,
    () => `const it: ${type} = [${fresh()}][0];`,
    () => `const it: ${type} = [${fresh()}, other][at & 1];`,
    () => `const all: ${type}[] = [${fresh()}, ${another()}, other];\n    const it: ${type} = all[at % 3];`,
    () => `const it: ${type} = { held: ${fresh()} }.held;`,
    () => `const it: ${type} = new Map([[1, ${fresh()}]]).get(1)!;`,
    () => `const { held: it }: { held: ${type} } = { held: ${fresh()} };`,
    () => `const [it]: ${type}[] = [${fresh()}];`,
    () => `const [, it = other]: (${type} | undefined)[] = [other, at % 2 ? ${fresh()} : undefined];`,
    () => `const it: ${type} = ((...all: ${type}[]) => all[all.length - 1])(other, ${fresh()});`,
    () => `const it: ${type} = [${fresh()}, ${another()}].find((_, where) => where === at % 2)!;`,
    () => `const it: ${type} = same(${fresh()});`,
    () => `const it: ${type} = back(${fresh()}, 2);`,
    () => `const it: ${type} = either(${fresh()}, other, at % 2 === 0);`,
    () => `const it: ${type} = (() => ${fresh()})();`,
    () => `const it = hand<${type}>(${fresh()}).next().value as ${type};`,
    () => `let it: ${type} = other;\n    for (const each of hand<${type}>(${fresh()})) it = each;`,
    () => `const it = steps.next(${fresh()}).value as ${type};`,
    () => `let it: ${type} = other;\n    try {\n      it = ${fresh()};\n      fails(at === 1);\n    } catch {\n      it = ${another()};\n    }`,
    () => `let it: ${type} = other;\n    try {\n      fails(at === 1);\n      it = ${fresh()};\n    } catch {\n      seen.push("caught");\n    } finally {\n      seen.push(${read()});\n    }`,
    () => `let it: ${type} = other;\n    for (let inner = 0; inner <= at % 2; inner++) it = inner ? ${another()} : ${fresh()};`,
    () => `const it: ${type} = makers[0](${value});`,
    () => `const it: ${type} = makers[at % makers.length](${value});`,
    () => `const it: ${type} = makers[at % makers.length](${value});`,
    () => `const it: ${type} = makers.at(-1)!(${value});`,
    () => `let it: ${type} = other;\n    for (const make of makers) it = make(${value});`,
    () => `let it: ${type} = other;\n    let next = 0;\n    while (next < makers.length) it = makers[next++](${value});`,
    () => `const it: ${type} = makers.map(make => make(${value}))[at % makers.length];`,
    () => `const it: ${type} = holders[at % holders.length].make(${value});`,
    () => `const it: ${type} = at % 2 ? makers[0](${value}) : other;`,
    () => `const it: ${type} = previous;\n    previous = makers[at % makers.length](${value});`,
    () => `const it: ${type} = previous;\n    previous = ${fresh()};`,
    () => `const it: ${type} = previous;\n    previous = ${fresh()};`,
    () => `const it: ${type} = older;\n    older = previous;\n    previous = ${fresh()};`,
    () => `const now: ${type} = ${fresh()};\n    const it: ${type} = at % 2 ? now : previous;\n    previous = now;`,
  ])();

  const rest: string[] = [];
  if (random.chance(0.2)) rest.push(stop());
  if (kind.changes.length) for (let more = random.below(3); more > 0; more--) rest.push(random.pick(kind.changes)("it", number()));
  if (canStop && random.chance(0.6)) rest.push(pause);
  if (again && random.chance(0.25)) rest.push(`if (depth > 0) seen.push(${again});`);
  if (random.chance(0.15)) rest.push("fails(at === 2);");
  rest.push(`seen.push(${read()});`);
  if (usesOwn && random.chance(0.6)) rest.push("own += 1;", `seen.push(${read()});`);
  if (random.chance(0.3)) rest.push(`if (at === ${random.below(3)}) kept = it;`);
  if (random.chance(0.3)) rest.push("last = it;");
  if (random.chance(0.15)) rest.push(`if (at === ${random.below(3)}) later.push(() => ${read()});`);
  if (random.chance(0.15)) rest.push(stop(), `seen.push(${read()});`);
  const inTurn = random.weighted<(text: string) => string>([
    [6, text => text],
    [1, text => `try {\n    ${text}\n    } finally {\n      seen.push(${read()});\n    }`],
    [1, text => `try {\n    ${text}\n    } catch {\n      seen.push("caught", ${read()});\n    }`],
  ]);
  const turn = [...(usesOwn ? [`let own = ${number()};`] : []), arrival, inTurn(rest.join("\n    "))].join("\n    ");
  const around = random.weighted<(text: string) => string>([
    [5, text => text],
    [1, text => `try {\n  ${text}\n  } catch {\n    seen.push("out");\n  }`],
    [1, text => `try {\n  ${text}\n  } finally {\n    seen.push(${read("last")});\n  }`],
    [1, text => `try {\n  ${text}\n  } catch {\n    seen.push("out", ${read("kept")});\n  } finally {\n    seen.push(${read("previous")});\n  }`],
  ]);
  const made = (value: string) => `(${kind.make(value)})`;
  const makersOf = random.pick([
    `makers.push(value => ${made("value")});`,
    `for (let more = 0; more < 2; more++) makers.push(value => ${made("(value + more)")});`,
    `for (let more = 0; more < 3; more++) makers.push(value => ${made("(value + more)")});`,
    `for (const more of given) makers.push(value => ${made("(value + more)")});`,
    `makers.push(value => ${made("value")}, value => ${made("(value + 20)")});`,
    `makers.push(value => ${made("value")}, () => other);`,
    `for (let more = 0; more < 2; more++) {\n    const text = "x".repeat(more);\n    makers.push(value => ${made("(value + text.length)")});\n  }`,
  ]);
  const behind = ["kept", "last", "other", "previous", "older"].filter(() => random.chance(0.4)).map(name => `seen.push(${read(name)});`);
  const body = `const seen: Seen = [];
  const later: (() => number | string | undefined)[] = [];
  const other: ${type} = ${kind.make("-1").replace("...other, ", "m: 7, ")};
  let previous: ${type} = other;
  let older: ${type} = other;
  let kept: ${type} = other;
  let last: ${type} = other;
  const steps = echo<${type}>(other);
  steps.next();
  const makers: ((value: number) => ${type})[] = [];
  ${makersOf}
  const holders = makers.map(make => ({ make }));
  ${around(`${loop.open}\n    ${turn}\n  ${loop.close}`)}
  ${behind.join("\n  ")}
  for (const reader of later) seen.push(reader());`;

  const depth = random.pick([0, 0, 1, 2]);
  const head = `(given: number[], depth: number)`;
  const [declaration, call] =
    form === "function"
      ? [`function scene${index}${head}: Seen {\n  ${body}\n  return seen;\n}`, (given: string) => `scene${index}(${given}, ${depth})`]
      : form === "arrow"
        ? [`const scene${index} = ${head}: Seen => {\n  ${body}\n  return seen;\n};`, (given: string) => `scene${index}(${given}, ${depth})`]
        : form === "method"
          ? [`class Holder${index} {\n  run${head}: Seen {\n  ${body}\n  return seen;\n  }\n}`, (given: string) => `new Holder${index}().run(${given}, ${depth})`]
          : form === "generator"
            ? [`function* scene${index}${head}: Generator<number, Seen, unknown> {\n  ${body}\n  return seen;\n}`, (given: string) => `drain(scene${index}(${given}, ${depth}))`]
            : form === "async"
              ? [`async function scene${index}${head}: Promise<Seen> {\n  ${body}\n  return seen;\n}`, (given: string) => `await scene${index}(${given}, ${depth})`]
              : ["", () => ""];
  if (form === "module") return `try {\n  const given = [5, 6, 7];\n  const depth = 0;\n  ${body}\n  console.log(${index}, JSON.stringify(seen));\n} catch (error) {\n  console.log(${index}, "threw", (error as Error).message);\n}`;
  const once = (given: string) => `JSON.stringify(${call(given)})`;
  const asked =
    turns === 1
      ? `console.log(${index}, ${once("[5, 6, 7]")});`
      : `const said = new Set<string>();\n  for (let turn = 0; turn < ${turns}; turn++) said.add(${once("turn % 7 ? [5, 6, 7] : [turn, 2]")});\n  console.log(${index}, [...said].join(" | "));`;
  return `${declaration}\ntry {\n  ${asked}\n} catch (error) {\n  console.log(${index}, "threw", (error as Error).message);\n}`;
}

export function generate(random: Random): string {
  // In some programs every scene makes one kind of thing: things of many places come to the same readers, from scenes that run once and from scenes that run often.
  const kindOfAll = random.chance(0.4) ? random.pick(kinds) : undefined;
  const count = kindOfAll ? random.between(4, 8) : random.between(2, 5);
  const turnsOfAll = random.pick([1, 1, 3, 300, undefined, undefined]);
  const declarations = new Map<string, string>();
  const scenes: string[] = [];
  for (let index = 0; index < count; index++) scenes.push(scene(random, index, turnsOfAll ?? random.pick([1, 200, 300]), declarations, kindOfAll ?? random.pick(kinds)));
  const of = (start: string) => [...declarations].filter(([name]) => name.startsWith(start)).map(([, text]) => text);
  const readers = [...of("read").filter(text => text.startsWith("function")), ...of("arrow"), ...of("bound")];
  if (of("readers.").length) readers.push(`const readers = {\n${of("readers.").join("\n")}\n};`);
  if (of("Reads.").length) readers.push(`class Reads {\n${of("Reads.").join("\n")}\n}`);
  return [prelude, ...readers, ...scenes, "export {};"].join("\n") + "\n";
}
