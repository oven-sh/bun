// In which order asynchronous steps run: what is awaited, times the form that awaits it, times the kind of the function, times who calls it. A chain of ticks runs beside the tasks, so that a step too many or too few shows.
//
//   bun write-await-order-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<operand>--<form>--<kind>--<caller>.mjs
//   bun write-await-order-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const operands: [name: string, text: string][] = [
  ["number", "k"],
  ["object", "{ a: k }"],
  ["nothing", "null"],
  ["resolved", "Promise.resolve(k)"],
  ["later", "later(k)"],
  ["rejected", 'Promise.reject(new RangeError("r" + k))'],
  ["rejected-later", "failsLater(k)"],
  ["thenable", "thenable(k)"],
  ["thenable-that-throws", "thenableThatThrows(k)"],
  ["thenable-that-rejects", "thenableThatRejects(k)"],
  ["thenable-called-twice", "thenableCalledTwice(k)"],
  ["thenable-of-thenable", "thenableOf(thenable(k))"],
  ["then-getter", "thenGetter(k)"],
  ["then-number", "{ then: k }"],
  ["heir", "Heir.resolve(k)"],
  ["heir-made", "new Heir(resolve => resolve(k))"],
  ["own-then", "ownThen(k)"],
  ["other-constructor", "otherConstructor(k)"],
  ["call", "work(k)"],
  ["call-at-once", "atOnce(k)"],
  ["call-that-fails", "fails(k)"],
  ["call-of-call", "outer(k)"],
  ["arrow", "(async () => k)()"],
  ["method", "box.work(k)"],
  ["static-method", "Box.make(k)"],
  ["sometimes-async", "sometimes(k)"],
  ["resolved-call", "Promise.resolve(work(k))"],
  ["made", "new Promise(resolve => resolve(k))"],
  ["made-of-promise", "new Promise(resolve => resolve(later(k)))"],
  ["made-that-throws", 'new Promise(() => {\n  throw new TypeError("made");\n})'],
  ["generator-step", "steps(k).next()"],
  ["then", "work(k).then(value => value)"],
  ["finally", 'work(k).finally(() => notes.push("F"))'],
  ["all", "Promise.all([k, later(k)])"],
  ["with-resolvers", "resolvers(k)"],
];
// `O` is the operand, `K` the counter's name.
const forms: [name: string, text: string][] = [
  ["awaited", "const value = await O;\nnote(value);"],
  ["returned", "return O;"],
  ["returned-awaited", "return await O;"],
  ["dropped", "await O;"],
  ["twice", 'await O;\nnotes.push("m");\nawait O;'],
  ["kept", 'const kept = O;\nnotes.push("b");\nnote(await kept);'],
  [
    "caught",
    'try {\n  note(await O);\n} catch (error) {\n  notes.push("c" + told(error));\n} finally {\n  notes.push("f");\n}',
  ],
  [
    "returned-in-try",
    'try {\n  return O;\n} catch (error) {\n  notes.push("never");\n} finally {\n  notes.push("f");\n}',
  ],
  ["returned-awaited-in-try", "try {\n  return await O;\n} catch (error) {\n  return told(error);\n}"],
  ["await-in-finally", 'try {\n  notes.push("t");\n  return 1;\n} finally {\n  await O;\n  notes.push("f");\n}'],
  ["await-in-catch", 'try {\n  throw new Error("x");\n} catch {\n  note(await O);\n}'],
  ["for-await-list", "for await (const value of [O, k]) note(value);"],
  ["for-await-generator", "for await (const value of yields(O, k)) note(value);"],
  ["for-await-break", "for await (const value of yields(k, O)) {\n  note(value);\n  break;\n}"],
  ["delegated", "for await (const value of delegates(O)) note(value);"],
  ["all", "note(await Promise.all([O, k, O]));"],
  ["all-settled", "note(await Promise.allSettled([O, work(k)]));"],
  ["race", "note(await Promise.race([O, later(9)]));"],
  ["any", "note(await Promise.any([O, later(9)]));"],
  ["chosen", 'note(await (k & 1 ? O : "plain"));'],
  ["guarded", "if (k) note(await O);\nnotes.push(k);"],
  ["operands", "note((await O) + (await k));"],
  ["list", "note([await O, k, await later(k)]);"],
  ["argument", "note(pair(await O, await k));"],
  ["added", 'let sum = "s";\nsum += await O;\nnote(sum);'],
  ["stored", "const out = [1, 2];\nout[await 0] = await O;\nnote(out);"],
  ["field", "const row = { a: 1, b: await O };\nrow.a = await k;\nnote(row);"],
  ["default", "const { a = await O } = {};\nnote(a);"],
  ["optional", "note((await O)?.a);"],
  ["loop", "for (let turn = 0; turn < 3; turn++) note(await O);"],
  ["loop-condition", "let turn = 0;\nwhile ((await O) !== undefined && turn++ < 2) notes.push(turn);"],
  ["switch", 'switch (await O) {\n  case 0:\n    note("zero");\n    break;\n  case 1:\n    note(await k);\n  default:\n    note("rest");\n}'], // prettier-ignore
  ["captured", "const value = await O;\nconst ask = () => value;\nawait null;\nnote(ask());"],
  ["mapped", "note(await Promise.all([k, 5].map(async turn => {\n  await turn;\n  return O;\n})));"],
  ["then", "Promise.resolve(O).then(note, error => notes.push(told(error)));"],
  ["then-returned", "return Promise.resolve(k).then(() => O);"],
  ["finally-call", "return work(k).finally(() => O);"],
  ["catch-call", "return fails(k).catch(() => O);"],
  ["made-of", "return new Promise(resolve => resolve(O));"],
  ["using", 'await using held = { [Symbol.asyncDispose]: async () => {\n  notes.push("u");\n  await null;\n  notes.push("v");\n} };\nnote(await O);'], // prettier-ignore
];
// `BODY` is the form; `task` is what the caller calls.
const kinds: [name: string, text: string][] = [
  ["declaration", "async function task(k) {\nBODY\n}"],
  ["arrow", "const task = async k => {\nBODY\n};"],
  ["method", "const tasks = {\n  size: 1,\n  async task(k) {\nBODY\n  },\n};\nconst task = k => tasks.task(k);"],
  [
    "class-method",
    "class Tasks {\n  async task(k) {\nBODY\n  }\n}\nconst made = new Tasks();\nconst task = k => made.task(k);",
  ],
  ["private-static", "class Tasks {\n  static async #run(k) {\nBODY\n  }\n  static task(k) {\n    return Tasks.#run(k);\n  }\n}\nconst task = k => Tasks.task(k);"], // prettier-ignore
  [
    "inner",
    "function make(size) {\n  return async k => {\n    notes.push(size);\nBODY\n  };\n}\nconst task = make(7);",
  ],
  ["generator", "async function* turns(k) {\nBODY\n}\nconst task = k => turns(k).next();"],
];
const callers: [name: string, text: string][] = [
  ["side-by-side", "for (let k = 0; k < 3; k++) task(k).then(note, failed);"],
  [
    "one-by-one",
    "for (let k = 0; k < 3; k++) {\n  try {\n    note(await task(k));\n  } catch (error) {\n    failed(error);\n  }\n}",
  ],
  ["all", "try {\n  note(await Promise.all([task(0), task(1), task(2)]));\n} catch (error) {\n  failed(error);\n}"],
  ["settled", "note(await Promise.allSettled([2, 1].map(k => task(k))));"],
  ["in-a-function", "const run = async () => {\n  let last;\n  for (const k of [1, 2]) last = await task(k);\n  return last;\n};\nrun().then(note, failed);\nawait run().catch(failed);"], // prettier-ignore
  [
    "from-a-turn",
    "await new Promise(resolve => setTimeout(resolve, 0));\ntask(1).then(note, failed);\ntask(2).then(note, failed);",
  ],
];
const total = operands.length * forms.length * kinds.length * callers.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const operand = pick(operands);
  const form = pick(forms);
  const kind = pick(kinds);
  const caller = pick(callers);
  const body = form[1].replaceAll(/\bO\b/g, () => (operand[1].startsWith("{") ? `(${operand[1]})` : operand[1]));
  const text = kind[1].replace("BODY", () => body.split("\n").map(line => "    " + line).join("\n")); // prettier-ignore
  const lines = [
    "const notes = [];",
    'process.on("unhandledRejection", error => notes.push("unhandled" + told(error)));',
    'const told = error => "!" + error?.name;',
    'const show = value => (value instanceof Error ? told(value) : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : String(value));',
    "const note = value => void notes.push(show(value));",
    'const failed = error => void notes.push("failed" + told(error));',
    "const pair = (a, b) => [a, b];",
    "const later = async k => {\n  await null;\n  await null;\n  return k;\n};",
    'const failsLater = async k => {\n  await null;\n  throw new SyntaxError("l" + k);\n};',
    'async function work(k) {\n  notes.push("w" + k);\n  await null;\n  return k + 0.5;\n}',
    "async function atOnce(k) {\n  return k;\n}",
    'async function fails(k) {\n  throw new RangeError("f" + k);\n}',
    "async function outer(k) {\n  return work(k);\n}",
    "const sometimes = k => (k & 1 ? work(k) : k);",
    'const thenable = k => ({\n  then(resolve) {\n    notes.push("h" + k);\n    resolve(k);\n  },\n});',
    'const thenableThatThrows = k => ({\n  then() {\n    throw new EvalError("t" + k);\n  },\n});',
    'const thenableThatRejects = k => ({\n  then(resolve, reject) {\n    reject(new URIError("t" + k));\n  },\n});',
    "const thenableCalledTwice = k => ({\n  then(resolve, reject) {\n    resolve(k);\n    resolve(k + 1);\n    reject(5);\n    throw 6;\n  },\n});",
    "const thenableOf = inner => ({ then: resolve => resolve(inner) });",
    'const thenGetter = k => ({\n  get then() {\n    notes.push("g" + k);\n    return undefined;\n  },\n});',
    'class Heir extends Promise {\n  then(...given) {\n    notes.push("H");\n    return super.then(...given);\n  }\n}',
    'const ownThen = k => {\n  const made = Promise.resolve(k);\n  made.then = function (resolve) {\n    notes.push("o");\n    resolve(k + 100);\n  };\n  return made;\n};',
    "const otherConstructor = k => {\n  const made = Promise.resolve(k);\n  made.constructor = Heir;\n  return made;\n};",
    "const resolvers = k => {\n  const { promise, resolve } = Promise.withResolvers();\n  resolve(k);\n  return promise;\n};",
    "class Box {\n  size = 2;\n  async work(k) {\n    await null;\n    return this.size + k;\n  }\n  static async make(k) {\n    return k * 2;\n  }\n}",
    "const box = new Box();",
    'async function* steps(k) {\n  try {\n    yield k;\n    yield work(k);\n  } finally {\n    notes.push("sf");\n  }\n}',
    'async function* yields(a, b) {\n  try {\n    yield a;\n    yield b;\n    return a;\n  } finally {\n    notes.push("yf");\n  }\n}',
    "async function* delegates(a) {\n  yield* yields(a, 1);\n  yield* [a, 2];\n}",
    "let ticks = 0;",
    'const tick = () => {\n  notes.push("." + ticks);\n  if (++ticks < 24) Promise.resolve().then(tick);\n};',
    ...text.split("\n"),
    "Promise.resolve().then(tick);",
    "try {",
    ...caller[1].split("\n").map(line => "  " + line),
    '} catch (error) {\n  notes.push("left" + told(error));\n}',
    "await new Promise(resolve => setTimeout(resolve, 2));",
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return { name: `${operand[0]}--${form[0]}--${kind[0]}--${caller[0]}.mjs`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(5, "0");
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
