// A function that walks a generator and answers, called by two callers: what the two generators yield, times how the function walks, times where the calls are, times what each caller takes of the answer.
//
//   bun write-generator-answer-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<walk>--<calls>--<yield>--<yield>--<take>--<take>.mjs
//   bun write-generator-answer-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts from 0, `n` is the number that the generator is given.
const yields: [name: string, text: string][] = [
  ["integers", "i + n"],
  ["doubles", "i * 0.5 + n"],
  ["texts", '"t" + i'],
  ["lists", "[i, n]"],
  ["objects", "{ v: i, w: n }"],
  ["functions", "() => i * n"],
  ["nested", "{ v: [i], w: { v: n } }"],
  ["by-turns", 'i & 1 ? "t" + i : i'],
  ["some-nothing", "i === 1 ? undefined : i"],
  ["object-or-number", "i === 1 ? { v: i, w: n } : i"],
  ["classes", "new Item(i, n)"],
  ["counting-functions", "() => outer++"],
];
// `it` is what is walked; `V` is the item as a number.
const walks: [name: string, text: string][] = [
  ["sum", "let sum = 0;\nfor (const item of it) sum += number(item);\nreturn sum;"],
  ["added", "let sum;\nfor (const item of it) sum = sum === undefined ? item : sum + item;\nreturn sum;"],
  ["last", "let last;\nfor (const item of it) last = item;\nreturn last;"],
  ["first", "for (const item of it) return item;"],
  ["second", "let turns = 0;\nfor (const item of it) if (turns++) return item;\nreturn turns;"],
  ["list", "const list = [];\nfor (const item of it) list.push(item);\nreturn list;"],
  ["appended", "const list = [];\nfor (const item of it) list[list.length] = item;\nreturn list;"],
  ["spread", "return [...it];"],
  ["pairs", "let turns = 0;\nconst pairs = [];\nfor (const item of it) pairs.push([turns++, item]);\nreturn pairs;"],
  [
    "record",
    "const record = { last: undefined, turns: 0 };\nfor (const item of it) {\n  record.last = item;\n  record.turns++;\n}\nreturn record;",
  ],
  [
    "largest",
    "let best;\nlet most = -1;\nfor (const item of it) {\n  if (number(item) > most) {\n    most = number(item);\n    best = item;\n  }\n}\nreturn best;",
  ],
  ["count", "let turns = 0;\nfor (const item of it) if (item !== undefined) turns++;\nreturn turns;"],
  ["text", 'let text = "";\nfor (const item of it) text += show(item);\nreturn text;'],
  [
    "hashed",
    "let result = 7;\nfor (const item of it) result = (Math.imul(result, 31) + number(item)) | 0;\nreturn result;",
  ],
  [
    "two-carried",
    'let text = "";\nlet count = 1;\nfor (const item of it) {\n  text += item;\n  count = count * 3 + text.length;\n}\nreturn text + ":" + count;',
  ],
  ["hand-loop", "let last;\nfor (let step = it.next(); !step.done; step = it.next()) last = step.value;\nreturn last;"],
  ["while", "const list = [];\nlet step;\nwhile (!(step = it.next()).done) list.push(step.value);\nreturn list;"],
  [
    "inner-walk",
    "let last;\nfor (const item of it) for (const inner of beside(2)) last = inner & 1 ? item : (last ?? item);\nreturn last;",
  ],
  [
    "walked-inside",
    "const list = [];\nfor (const inner of beside(2)) for (const item of it) list.push([inner, item]);\nreturn list;",
  ],
  [
    "tried",
    'let last;\ntry {\n  for (const item of it) last = item;\n} finally {\n  notes.push("f");\n}\nreturn last;',
  ],
  [
    "tried-inside",
    "let last;\nfor (const item of it) {\n  try {\n    last = item.v ?? item;\n  } catch {\n    last = 0;\n  }\n}\nreturn last;",
  ],
  ["called", 'let last;\nfor (const item of it) last = typeof item === "function" ? item() : item;\nreturn last;'],
  ["captured", "const asks = [];\nfor (const item of it) asks.push(() => item);\nreturn asks[asks.length - 1]();"],
  [
    "passed-on",
    "const collect = inner => {\n  let last;\n  for (const item of inner) last = item;\n  return last;\n};\nreturn collect(it);",
  ],
  ["generator-again", "let last;\nfor (const item of (function* () {\n  yield* it;\n})()) last = item;\nreturn last;"],
  ["kept-too", "let last;\nfor (const item of it) {\n  kept.push(item);\n  last = item;\n}\nreturn last;"],
  [
    "both-broken-off",
    "let last;\nlet turns = 0;\nfor (const item of it) {\n  for (const inner of beside(2)) {\n    last = [item, inner];\n    if (++turns > 4) break;\n  }\n  if (turns > 6) break;\n}\nreturn last;",
  ],
  [
    "inner-notes",
    "let turns = 0;\nfor (const item of it) {\n  for (const inner of beside(2)) {\n    notes.push(show([item, inner]));\n    if (++turns > 4) break;\n  }\n  if (turns > 6) break;\n}\nreturn turns;",
  ],
  [
    "zipped",
    "const other = beside(3);\nlet last;\nfor (const item of it) {\n  const { value, done } = other.next();\n  if (done) break;\n  last = [item, value];\n}\nreturn last;",
  ],
  [
    "broken-off",
    "let last;\nlet turns = 0;\nfor (const item of it) {\n  last = item;\n  if (++turns === 2) break;\n}\nreturn last;",
  ],
];
// `ONE` and `OTHER` are the two generators made, `TAKE1` and `TAKE2` what is taken of `answer`.
const calls: [name: string, text: string][] = [
  [
    "two-functions",
    "function first(n) {\n  const answer = walk(ONE);\n  return TAKE1;\n}\nfunction second(n) {\n  const answer = walk(OTHER);\n  return TAKE2;\n}\nROUND",
  ],
  [
    "once",
    "function first(n) {\n  const answer = walk(n & 1 ? ONE : OTHER);\n  return TAKE1;\n}\nfunction second(n) {\n  return n;\n}\nROUND",
  ],
  [
    "one-function",
    "function first(n) {\n  let told;\n  {\n    const answer = walk(ONE);\n    told = TAKE1;\n  }\n  const answer = walk(OTHER);\n  return [told, TAKE2];\n}\nfunction second(n) {\n  return n;\n}\nROUND",
  ],
  [
    "same-generator",
    "function first(n) {\n  const answer = walk(ONE);\n  return TAKE1;\n}\nfunction second(n) {\n  const answer = walk(ONE);\n  return TAKE2;\n}\nROUND",
  ],
  [
    "one-calls",
    "function second(n) {\n  const answer = walk(OTHER);\n  return TAKE2;\n}\nfunction first(n) {\n  const answer = walk(ONE);\n  return [TAKE1, second(n)];\n}\nROUND",
  ],
  [
    "kept-generator",
    "function first(n) {\n  const it = ONE;\n  it.next();\n  const answer = walk(it);\n  return TAKE1;\n}\nfunction second(n) {\n  const it = OTHER;\n  const answer = walk(it);\n  return [TAKE2, it.next().done];\n}\nROUND",
  ],
  [
    "in-a-generator",
    "function* answers(n) {\n  const answer = walk(ONE);\n  yield TAKE1;\n}\nfunction first(n) {\n  return [...answers(n)];\n}\nfunction second(n) {\n  const answer = walk(OTHER);\n  return TAKE2;\n}\nROUND",
  ],
  [
    "both-in-a-loop",
    "function first(n) {\n  const told = [];\n  for (let round = 0; round < 3; round++) {\n    const answer = round === 1 ? walk(OTHER) : walk(ONE);\n    told.push(TAKE1);\n  }\n  return told;\n}\nfunction second(n) {\n  const answer = walk(OTHER);\n  return TAKE2;\n}\nROUND",
  ],
  [
    "callbacks",
    "const first = n => [n, n + 1].map(n => {\n  const answer = walk(ONE);\n  return TAKE1;\n});\nconst second = n => [n].map(n => {\n  const answer = walk(OTHER);\n  return TAKE2;\n});\nROUND",
  ],
  [
    "methods",
    "const asks = {\n  first(n) {\n    const answer = walk(ONE);\n    return TAKE1;\n  },\n  second(n) {\n    const answer = walk(OTHER);\n    return TAKE2;\n  },\n};\nconst first = n => asks.first(n);\nconst second = n => asks.second(n);\nROUND",
  ],
  [
    "tried",
    "function first(n) {\n  try {\n    const answer = walk(ONE);\n    return TAKE1;\n  } catch (error) {\n    return error.name;\n  }\n}\nfunction second(n) {\n  const answer = walk(OTHER);\n  return TAKE2;\n}\nROUND",
  ],
  [
    "in-a-loop-at-the-top",
    "const n = numbers[0];\ntry {\n  for (let round = 0; round < 2; round++) {\n    const made = ONE;\n    const answer = walk(made);\n    notes.push(show(TAKE1));\n  }\n} catch (error) {\n  notes.push(error.name);\n}",
  ],
  [
    "two-loops-at-the-top",
    "for (const n of numbers) {\n  try {\n    for (let round = 0; round < 2; round++) {\n      const answer = walk(ONE);\n      notes.push(show(TAKE1));\n    }\n  } catch (error) {\n    notes.push(error.name);\n  }\n  for (const answer of [walk([1, 2].values())]) attempt(() => TAKE2);\n}",
  ],
  [
    "at-the-top",
    "for (const n of numbers) {\n  attempt(() => {\n    const answer = walk(ONE);\n    return TAKE1;\n  });\n  attempt(() => {\n    const answer = walk(OTHER);\n    return TAKE2;\n  });\n}",
  ],
];
// How a generator counts; `V` is what it yields, `list` one of several lists, by the number it is given.
const bodies: [name: string, text: string][] = [
  ["counts", "for (let i = 0; i < n; i++) yield V;"],
  [
    "indices",
    "const list = lists[n % lists.length];\nfor (let at = 0; at < n; at++) {\n  const i = list[at];\n  yield V;\n}",
  ],
  [
    "masked",
    "const list = lists[n % lists.length];\nfor (let at = 0; at < n + 2; at++) {\n  const i = Math.imul(list[at & 3], 3);\n  yield V;\n}",
  ],
  ["elements", "for (const i of lists[n % lists.length]) yield V;"],
  [
    "length",
    "const list = lists[n % lists.length];\nfor (let at = 0; at < list.length; at++) {\n  const i = list[at];\n  yield V;\n}",
  ],
  [
    "typed-list",
    "const list = [new Int32Array([4, 5]), new Float64Array([0.5, 2, 3])][n & 1];\nfor (let at = 0; at < 3; at++) {\n  const i = list[at];\n  yield V;\n}",
  ],
  ["while", "let i = 0;\nwhile (i < n) {\n  yield V;\n  i++;\n}"],
  ["down", "for (let i = n; i-- > 0; ) yield V;"],
];
// The generator that the walks step beside.
const besides: [name: string, text: string][] = [
  ["counts", "for (let i = 0; i < n; i++) yield i;"],
  ["finally", 'try {\n  for (let i = 0; i < n; i++) yield i;\n} finally {\n  notes.push("bf");\n}'],
  ["throws-in-finally", 'try {\n  yield n;\n  yield 2;\n} finally {\n  throw new URIError("bf");\n}'],
  ["throws-behind-one", 'yield n;\nthrow new RangeError("b");'],
  ["texts", 'for (let i = 0; i < n; i++) yield "b" + i;'],
];
const takes: [name: string, text: string][] = [
  ["itself", "answer"],
  ["plus", "answer + 1"],
  ["minus", "answer - 1"],
  ["integer", "answer | 0"],
  ["text", "`${answer}`.length"],
  ["length", "answer.length"],
  ["element", "answer[0]"],
  ["field", "answer.v"],
  ["field-plus", "answer.v + answer.w"],
  ["maybe", "answer?.v ?? -1"],
  ["kind", "typeof answer"],
  ["nothing", "n"],
  ["compared", "answer > 2"],
  ["truth", "answer ? 1 : 0"],
  ["held", "(kept.push(answer), kept.length)"],
  ["called", 'typeof answer === "function" ? answer() : 0'],
  ["mapped", "answer.map(item => show(item)).join()"],
  ["summed", "answer.reduce((sum, item) => sum + number(item), 0)"],
];
const rounds: [name: string, text: string][] = [
  ["three", "[1, 2, 3]"],
  ["parsed", 'JSON.parse("[3, 0, 2]")'],
  ["one", "[2]"],
];
const total =
  yields.length *
  yields.length *
  walks.length *
  calls.length *
  takes.length *
  takes.length *
  rounds.length *
  besides.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const walk = pick(walks);
  const call = pick(calls);
  const one = pick(yields);
  const other = pick(yields);
  const take = pick(takes);
  const otherTake = pick(takes);
  const round = pick(rounds);
  const beside = pick(besides);
  const generator = pick(bodies);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const body = call[1]
    .replaceAll("ONE", "one(n + 1)")
    .replaceAll("OTHER", "other(n + 2)")
    .replaceAll("TAKE1", () => take[1])
    .replaceAll("TAKE2", () => otherTake[1])
    .replace("ROUND", "for (const n of numbers) {\n  attempt(() => first(n));\n  attempt(() => second(n));\n}");
  const lines = [
    "const notes = [];",
    "const kept = [];",
    "let outer = 0;",
    "class Item {\n  constructor(v, w) {\n    this.v = v;\n    this.w = w;\n  }\n}",
    'const number = item => (typeof item === "number" ? item : typeof item === "object" && item ? Number(item.v ?? 0) : typeof item === "function" ? item() : 1);',
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : String(value));',
    "const attempt = ask => {\n  try {\n    notes.push(show(ask()));\n  } catch (error) {\n    notes.push(error.name);\n  }\n};",
    `const numbers = ${round[1]};`,
    `function* beside(n) {\n${indent(beside[1], "  ")}\n}`,
    ...(generator[1].includes("lists") ? ['const lists = [[1, 4], [1.5, 4], [1, 2, 3, 4], [], ["a", 2], [1, 2, 3.5, 4], [1, , 3]];'] : []),
    `function* one(n) {\n${indent(generator[1].replace(/\bV\b/, () => one[1]), "  ")}\n}`,
    `function* other(n) {\n${indent(generator[1].replace(/\bV\b/, () => other[1]), "  ")}\n}`,
    `function walk(it) {\n${indent(walk[1], "  ")}\n}`,
    body,
    'console.log(notes.join(" "), kept.length);',
  ]; // prettier-ignore
  return {
    name: `${walk[0]}--${call[0]}--${one[0]}--${other[0]}--${take[0]}--${otherTake[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
