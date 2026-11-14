// Generators: what the body does, times how the generator is handed on, times who steps it, times how often, times the generator that stands beside. Bodies note what they are sent and that they are closed.
//
//   bun write-generator-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<body>--<handing>--<consumer>--<round>--<second>.mjs
//   bun write-generator-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `gen` takes a number; a body that never ends is told by `true`.
const bodies: [name: string, text: string, isEndless?: boolean][] = [
  ["counts", "function* gen(n) {\n  for (let i = 0; i < n; i++) yield i;\n}"],
  ["counts-down", "function* gen(n) {\n  while (n > 0) {\n    n--;\n    yield n + 1;\n  }\n}"],
  ["endless", "function* gen(n) {\n  let i = n;\n  while (true) yield i++;\n}", true],
  ["endless-for", "function* gen(n) {\n  for (let i = 0; ; i += n) yield i * 0.5;\n}", true],
  [
    "two",
    'function* gen(n) {\n  notes.push("a");\n  yield n;\n  notes.push("b");\n  yield n + 0.5;\n  notes.push("c");\n}',
  ],
  ["three-kinds", 'function* gen(n) {\n  yield n;\n  yield "t" + n;\n  yield { a: n };\n}'],
  ["nothing", "function* gen(n) {}"],
  ["returns", 'function* gen(n) {\n  yield n;\n  return "last" + n;\n}'],
  [
    "returns-early",
    "function* gen(n) {\n  for (let i = 0; i < 9; i++) {\n    if (i === n) return i;\n    yield i;\n  }\n}",
  ],
  [
    "finally",
    'function* gen(n) {\n  try {\n    for (let i = 0; i < n; i++) yield i;\n  } finally {\n    notes.push("f");\n  }\n}',
  ],
  [
    "finally-that-yields",
    'function* gen(n) {\n  try {\n    yield n;\n    yield 2;\n  } finally {\n    yield "cleanup";\n    notes.push("f");\n  }\n}',
  ],
  [
    "catches",
    'function* gen(n) {\n  for (let i = 0; i < n; i++) {\n    try {\n      yield i;\n    } catch (error) {\n      notes.push("c" + error.name);\n    }\n  }\n}',
  ],
  [
    "is-sent",
    'function* gen(n) {\n  let sum = 0;\n  for (let i = 0; i < n; i++) {\n    const sent = yield sum;\n    notes.push("s" + sent);\n    sum += sent ?? 1;\n  }\n  return sum;\n}',
  ],
  ["throws", 'function* gen(n) {\n  yield 1;\n  if (n > 2) throw new RangeError("g");\n  yield 2;\n}'],
  ["delegates-list", "function* gen(n) {\n  yield* [n, n * 2];\n  yield 9;\n}"],
  [
    "delegates",
    'function* inner(n) {\n  const sent = yield n;\n  notes.push("i" + sent);\n  return n * 3;\n}\nfunction* gen(n) {\n  const got = yield* inner(n);\n  yield got;\n}',
  ],
  [
    "walks-a-tree",
    "function* gen(n) {\n  if (n > 4) return;\n  yield* gen(n * 2 + 1);\n  yield n;\n  yield* gen(n * 2 + 2);\n}",
  ],
  ["outer-variable", "let outer = 0;\nfunction* gen(n) {\n  for (let i = 0; i < n; i++) yield outer++;\n}"],
  ["closures", "function* gen(n) {\n  for (let i = 0; i < n; i++) yield () => i + n;\n}"],
  [
    "method",
    "class Items {\n  list = [4, 5, 6];\n  *walk(n) {\n    for (const item of this.list) yield item * n;\n  }\n}\nconst items = new Items();\nconst gen = n => items.walk(n);",
  ],
  [
    "iterator-of-class",
    "class Row {\n  constructor(n) {\n    this.n = n;\n  }\n  *[Symbol.iterator]() {\n    for (let i = 0; i < this.n; i++) yield i + this.n;\n  }\n}\nconst gen = n => new Row(n)[Symbol.iterator]();",
  ],
  ["bound", "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst gen = base.bind(null);"],
  [
    "bound-with-finally",
    'function* base(n) {\n  try {\n    for (let i = 0; i < n; i++) yield [i];\n  } finally {\n    notes.push("bf");\n  }\n}\nconst gen = base.bind(null);',
  ],
  ["bound-argument", "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst gen = base.bind(null, 3);"],
  ["called", "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst gen = n => base.call(null, n);"],
  [
    "applied",
    "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst gen = n => Reflect.apply(base, null, [n]);",
  ],
  [
    "through-an-arrow",
    'function* base(n) {\n  try {\n    for (let i = 0; i < n; i++) yield [i];\n  } finally {\n    notes.push("bf");\n  }\n}\nconst gen = n => base(n);',
  ],
  [
    "of-a-field",
    "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst makers = { base };\nconst gen = n => makers.base(n);",
  ],
  [
    "of-a-list",
    "function* other(n) {\n  yield n;\n}\nfunction* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst makers = [base, other];\nconst gen = n => makers[n & 1](n);",
  ],
  [
    "chosen",
    "function* other(n) {\n  yield -n;\n}\nfunction* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nconst gen = n => (n > 2 ? base(n) : other(n));",
  ],
  ["default-argument", "function* gen(n, end = 3) {\n  for (let i = n; i < end; i++) yield i;\n}"],
  [
    "replaced",
    "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nlet gen = base;\ngen = gen.bind(null);",
  ],
  [
    "two-variables",
    "function* gen(n) {\n  let a = 0;\n  let b = 1;\n  for (let i = 0; i < n + 2; i++) {\n    yield a;\n    [a, b] = [b, a + b];\n  }\n}",
  ],
  [
    "kept-text",
    'function* gen(n) {\n  let text = "";\n  while (text.length < n) {\n    text += "x";\n    yield text;\n  }\n}',
  ],
  [
    "yields-in-a-call",
    "function* gen(n) {\n  const got = yield n;\n  note(got);\n  const first = yield 1;\n  const other = yield 2;\n  note(first ?? other);\n}",
  ],
  ["pattern", "function* gen(n, { by = 2 } = {}) {\n  for (let i = 0; i < n; i += by) yield i;\n}"],
  ["arguments", "function* gen() {\n  for (const given of arguments) yield given;\n  yield arguments.length;\n}"],
  ["pairs", 'function* gen(n) {\n  for (let i = 0; i < n; i++) yield ["k" + i, i];\n}'],
  [
    "wrapped",
    "function* base(n) {\n  for (let i = 0; i < n; i++) yield i;\n}\nfunction* gen(n) {\n  for (const item of base(n)) if (item & 1) yield item * 10;\n}",
  ],
  ["by-arrow-of-steps", "const gen = n => [n, 1, n + 2].values();"],
  ["of-map", 'const gen = n => new Map([["a", n], ["b", 2]]).entries();'],
];
// `it` is what the consumer steps; `n` the number.
const handings: [name: string, text: string][] = [
  ["argument", "use(gen(n), n);"],
  ["variable", "const made = gen(n);\nuse(made, n);"],
  ["stepped-once", "const made = gen(n);\nmade.next();\nuse(made, n);"],
  ["field", "const holder = { made: gen(n) };\nuse(holder.made, n);"],
  ["element", "const made = [gen(n), gen(n + 1)];\nuse(made[1], n);\nuse(made[0], n);"],
  ["returned", "const make = () => gen(n);\nuse(make(), n);"],
  ["twice", "const made = gen(n);\nuse(made, n);\nuse(made, n);"],
  ["two-kinds", "use(gen(n), n);\nuse([n, 7][Symbol.iterator](), n);"],
  ["captured", "const made = gen(n);\n(() => use(made, n))();"],
  ["through-a-generator", "use((function* () {\n  yield* gen(n);\n})(), n);"],
  ["in-place", "INLINE"],
];
// A consumer that steps to the end is told by `true`.
const consumers: [name: string, text: string, isToTheEnd: boolean][] = [
  ["for-of", "for (const item of it) note(item);", true],
  ["for-of-sum", 'let sum = 0;\nfor (const item of it) sum += typeof item === "number" ? item : 1;\nnote(sum);', true],
  ["for-of-break", "for (const item of it) {\n  note(item);\n  if (++turns === 2) break;\n}", false],
  [
    "for-of-return",
    "const first = () => {\n  for (const item of it) return item;\n};\nnote(first());\nnote(it.next());",
    false,
  ],
  [
    "for-of-throw",
    'try {\n  for (const item of it) {\n    note(item);\n    throw new EvalError("u");\n  }\n} catch (error) {\n  notes.push(told(error));\n}\nnote(it.next());',
    false,
  ],
  [
    "for-of-continue",
    "outer: for (const a of [1, 2]) {\n  for (const item of it) {\n    note(item);\n    if (a === 1) continue outer;\n    if (++turns > 2) break outer;\n  }\n}",
    false,
  ],
  ["hand-loop", "for (let step = it.next(); !step.done; step = it.next()) note(step.value);", true],
  ["while", "let step;\nwhile (!(step = it.next()).done) note(step.value);\nnote(step.value);", true],
  ["three-steps", "note(it.next());\nnote(it.next());\nnote(it.next().value);", false],
  ["counted", "for (let i = 0; i < 4; i++) {\n  const { value, done } = it.next(i);\n  note([value, done]);\n}", false],
  ["sends", 'note(it.next("x"));\nnote(it.next("y"));\nnote(it.next(5));', false],
  ["returns", "note(it.next());\nnote(it.return?.(7));\nnote(it.next());", false],
  [
    "throws",
    'note(it.next());\ntry {\n  note(it.throw(new TypeError("in")));\n} catch (error) {\n  notes.push(told(error));\n}\nnote(it.next());',
    false,
  ],
  ["spread", "note([...it]);", true],
  ["list-from", "note(Array.from(it, item => [item]));", true],
  ["pattern", "const [a, , b] = it;\nnote([a, b]);\nnote(it.next());", false],
  ["pattern-rest", "const [a, ...others] = it;\nnote([a, others]);", true],
  ["set", "note([...new Set(it)]);", true],
  ["arguments", "note(Math.max(...it));", true],
  [
    "zipped",
    "const other = second(2);\nfor (let i = 0; i < 3; i++) {\n  const a = it.next();\n  const b = other.next();\n  if (a.done || b.done) break;\n  note([a.value, b.value]);\n}",
    false,
  ],
  [
    "zipped-in-one-declaration",
    "const other = second(n);\nfor (;;) {\n  const a = it.next(),\n    b = other.next();\n  if (a.done || b.done) break;\n  note([a.value, b.value]);\n}",
    true,
  ],
  [
    "zipped-without-values",
    "const other = second(n);\nfor (;;) {\n  const a = it.next(),\n    b = other.next();\n  if (a.done || b.done || turns++ > 4) break;\n}",
    false,
  ],
  [
    "zipped-other-first",
    "const other = second(n);\nfor (let i = 0; i < 3; i++) {\n  const b = other.next(i);\n  const a = it.next(i);\n  note([a.value, b.value, a.done, b.done]);\n}",
    false,
  ],
  [
    "zipped-in-try",
    'const other = second(2);\ntry {\n  for (let i = 0; i < 3; i++) note([it.next().value, other.next().value]);\n} catch (error) {\n  notes.push("z" + told(error));\n} finally {\n  notes.push("zf");\n}',
    false,
  ],
  [
    "zipped-tried-inside",
    'const other = second(2);\nfor (let i = 0; i < 3; i++) {\n  try {\n    note([it.next().value, other.next().value]);\n  } catch (error) {\n    notes.push("z" + told(error));\n  }\n}',
    false,
  ],
  [
    "zipped-while",
    "const other = second(2);\nlet a = it.next();\nlet b = other.next();\nwhile (!a.done && !b.done && turns++ < 4) {\n  note([a.value, b.value]);\n  a = it.next();\n  b = other.next();\n}",
    false,
  ],
  ["by-turns", "const other = second(3);\nfor (let i = 0; i < 5; i++) note((i & 1 ? it : other).next().value);", false],
  [
    "steps-in-for-of",
    "const other = second(2);\nfor (const item of it) {\n  const { value, done } = other.next();\n  note([item, value]);\n  if (done || ++turns > 3) break;\n}",
    false,
  ],
  [
    "for-of-in-steps",
    "for (let step = it.next(); !step.done && turns < 3; step = it.next()) {\n  for (const item of second(2)) {\n    note([step.value, item]);\n    if (++turns > 2) break;\n  }\n}",
    true,
  ],
  ["two-patterns", "const other = second(3);\nconst [a] = it;\nconst [b, c] = other;\nnote([a, b, c]);", false],
  [
    "thrown-between",
    'const other = second(3);\ntry {\n  for (let i = 0; i < 4; i++) {\n    const a = it.next();\n    if (i === 1) throw new EvalError("b");\n    note([a.value, other.next().value]);\n  }\n} catch (error) {\n  notes.push(told(error));\n}\nnote([it.next(), other.next()]);',
    false,
  ],
  [
    "closes-other",
    "const other = second(3);\nnote(other.next());\nfor (const item of it) {\n  note(item);\n  note(other.return(item));\n  break;\n}",
    false,
  ],
  [
    "throws-into-other",
    'const other = second(3);\nfor (let i = 0; i < 3; i++) {\n  const a = it.next();\n  try {\n    note(i ? other.throw(new TypeError("to")) : other.next());\n  } catch (error) {\n    notes.push(told(error));\n  }\n  note(a.value);\n}',
    false,
  ],
  [
    "two-loops",
    "for (const item of it) {\n  for (const other of second(2)) {\n    note([item, other]);\n    if (++turns > 4) break;\n  }\n  if (turns > 6) break;\n}",
    true,
  ],
  ["mapped", "note(it.map(item => [item, 1]).take(3).toArray());", false],
  ["filtered", "for (const item of it.filter(item => item !== 1).take(2)) note(item);", false],
  ["dropped", "note(it.drop(1).take(2).toArray());\nnote(it.next());", false],
  ["found", "note(it.find(item => item !== 0));\nnote(it.next());", true],
  ["some", "note(it.some(item => item === 1));", true],
  ["reduced", 'note(it.take(4).reduce((sum, item) => sum + show(item), ""));', false],
  ["flat", "note(it.take(3).flatMap(item => [item, item]).toArray());", false],
  [
    "itself",
    "note([it[Symbol.iterator]() === it, typeof it.next, Object.prototype.toString.call(it)]);\nfor (const item of it[Symbol.iterator]()) {\n  note(item);\n  break;\n}",
    false,
  ],
  [
    "own-next",
    "let left = 2;\nit.next = () => ({ done: left-- === 0, value: 50 });\nfor (const item of it) note(item);",
    false,
  ],
  [
    "own-return",
    'it.return = () => {\n  notes.push("own");\n  return {};\n};\nfor (const item of it) {\n  note(item);\n  break;\n}',
    false,
  ],
  ["entries", "note(Object.keys(it));\nnote([...it].length);", true],
  [
    "wrapped",
    "const wrap = function* (inner) {\n  for (const item of inner) yield [item];\n};\nfor (const item of wrap(it)) {\n  note(item);\n  if (++turns > 3) break;\n}",
    false,
  ],
  ["stored", "const out = [];\nfor (const item of it) out[out.length] = item;\nnote(out);", true],
  [
    "captured-items",
    "const asks = [];\nfor (const item of it) asks.push(() => item);\nnote(asks.map(ask => ask()));",
    true,
  ],
  ["called-items", 'for (const item of it) note(typeof item === "function" ? item() : item);', true],
];
// What a body yields in the place of a value.
const yields: [name: string, text: string][] = [
  ["as-it-is", ""],
  ["list", "[V]"],
  ["object", "{ v: V }"],
  ["text", '"" + V'],
  ["function", "() => V"],
];
// `second` is the generator that stands beside.
const seconds: [name: string, text: string][] = [
  ["itself", "const second = n => gen(n);"],
  ["counts", "function* second(n) {\n  for (let i = 10; i < 10 + n; i++) yield i;\n}"],
  ["throws-at-once", 'function* second(n) {\n  throw new RangeError("o" + n);\n}'],
  ["throws-behind-one", 'function* second(n) {\n  yield n;\n  throw new SyntaxError("o");\n}'],
  ["ends-at-once", "function* second(n) {}"],
  [
    "throws-in-a-loop",
    'function* second(n) {\n  for (let i = 0; i < n; i++) if (i === 1) throw new RangeError("ol");\n}',
  ],
  [
    "finally",
    'function* second(n) {\n  try {\n    for (let i = 0; i < n + 1; i++) yield "o" + i;\n  } finally {\n    notes.push("of");\n  }\n}',
  ],
  [
    "throws-in-finally",
    'function* second(n) {\n  try {\n    yield n;\n    yield 2;\n  } finally {\n    throw new URIError("of");\n  }\n}',
  ],
  [
    "catches",
    'function* second(n) {\n  for (let i = 0; i < 6; i++) {\n    try {\n      yield n++;\n    } catch (error) {\n      notes.push("oc" + error.name);\n    }\n  }\n}',
  ],
];
const rounds: [name: string, text: string][] = [
  ["loop", "for (let n = 1; n < 5; n++) {\nHAND\n}"],
  ["parsed", 'const n = JSON.parse("3");\nfor (let round = 0; round < 2; round++) {\nHAND\n}'],
  ["written", "{\n  const n = 2;\nHAND\n}\n{\n  const n = 4;\nHAND\n}"],
  ["in-a-function", "const turn = n => {\nHAND\n};\nfor (const n of [3, 1, 3]) turn(n);"],
  [
    "tried",
    'for (let n = 3; n >= 0; n--) {\n  try {\nHAND\n  } catch (error) {\n    notes.push("t" + told(error));\n  }\n}',
  ],
];
const total = bodies.length * handings.length * consumers.length * rounds.length * seconds.length * yields.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const body = pick(bodies);
  const handing = pick(handings);
  const consumer = pick(consumers);
  const round = pick(rounds);
  const second = pick(seconds);
  const yielded = pick(yields);
  const wrap = (text: string) => (yielded[1] ? text.replaceAll(/\byield (?!\*)([^;\n]+);/g, (_, value) => `yield ${yielded[1].replace("V", () => `(${value})`)};`) : text); // prettier-ignore
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  // Nobody steps an endless body to its end.
  const isCut = body[2] && consumer[2];
  const made = isCut ? "gen(n).take(5)" : "gen(n)";
  const inline = `{\n  const it = ${made};\n  let turns = 0;\n${indent(consumer[1], "  ")}\n}`;
  const hand = handing[1].replace("INLINE", () => inline).replaceAll("gen(n)", () => made).replace("gen(n).take(5).take(5)", "gen(n).take(5)").replaceAll("gen(n + 1)", () => (isCut ? "gen(n + 1).take(5)" : "gen(n + 1)")); // prettier-ignore
  const lines = [
    "const notes = [];",
    'const told = error => "!" + error.name;',
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : typeof value === "string" ? value : String(value));',
    "const note = value => void notes.push(show(value));",
    ...wrap(body[1]).split("\n"),
    ...second[1].split("\n"),
    "function use(it, n) {",
    "  let turns = 0;",
    ...indent(consumer[1], "  ").split("\n"),
    "}",
    "try {",
    ...indent(round[1].replaceAll("HAND", () => indent(hand, "    ")), "  ").split("\n"),
    "} catch (error) {",
    '  notes.push("left" + told(error));',
    "}",
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${body[0]}--${handing[0]}--${consumer[0]}--${round[0]}--${second[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
