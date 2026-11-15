// Chains of promises: how the chain starts, times its first link, times its second link, times its end, times what stands beside it, times how many run at once.
//
//   bun write-promise-chain-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<start>--<first>--<second>--<end>--<beside>--<round>.mjs
//   bun write-promise-chain-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number; every link notes its turn.
const starts: [name: string, text: string][] = [
  ["resolved", "Promise.resolve(n)"],
  ["rejected", 'Promise.reject(new RangeError("s" + n))'],
  ["executor", "new Promise(resolve => resolve(n))"],
  ["executor-late", "new Promise(resolve => queueMicrotask(() => resolve(n)))"],
  ["executor-throws", 'new Promise(() => {\n  throw new TypeError("x");\n})'],
  ["executor-twice", "new Promise((resolve, reject) => {\n  resolve(n);\n  reject(1);\n  resolve(2);\n})"],
  ["of-a-promise", "Promise.resolve(Promise.resolve(n))"],
  ["thenable", 'Promise.resolve({ then(resolve) {\n  note("then");\n  resolve(n);\n} })'],
  ["thenable-throws", 'Promise.resolve({ then() {\n  throw new EvalError("t");\n} })'],
  ["async", "(async () => n)()"],
  ["async-awaits", "(async () => {\n  await null;\n  return n;\n})()"],
  ["async-throws", '(async () => {\n  throw new SyntaxError("a");\n})()'],
  ["all", "Promise.all([n, Promise.resolve(2)])"],
  ["all-rejects", 'Promise.all([n, Promise.reject(new Error("all"))])'],
  ["race", "Promise.race([Promise.resolve(n), 5])"],
  ["any", "Promise.any([Promise.reject(1), Promise.resolve(n)])"],
  ["settled", "Promise.allSettled([n, Promise.reject(2)])"],
  ["subclass", "Own.resolve(n)"],
  [
    "with-resolvers",
    "(() => {\n  const { promise, resolve } = Promise.withResolvers();\n  resolve(n);\n  return promise;\n})()",
  ],
  ["kept", "kept"],
  ["try", "Promise.try(() => n)"],
];
// Links that stand behind the chain.
const links: [name: string, text: string][] = [
  ["value", '.then(value => {\n  note("v", value);\n  return value;\n})'],
  ["number", ".then(value => value + 1)"],
  ["object", ".then(value => ({ value }))"],
  ["promise", ".then(value => Promise.resolve(value))"],
  ["late-promise", ".then(value => new Promise(resolve => queueMicrotask(() => resolve(value))))"],
  ["thenable", ".then(value => ({ then: resolve => resolve(value) }))"],
  ["async", '.then(async value => {\n  await null;\n  note("a");\n  return value;\n})'],
  ["throws", '.then(() => {\n  throw new URIError("l");\n})'],
  ["both", '.then(\n  value => value,\n  error => "!" + (error?.name ?? error),\n)'],
  ["catch", '.catch(error => {\n  note("c", error?.name);\n  return 8;\n})'],
  ["catch-throws", ".catch(error => {\n  throw error;\n})"],
  ["finally", '.finally(() => note("f"))'],
  ["finally-throws", '.finally(() => {\n  throw new RangeError("ff");\n})'],
  ["finally-promise", ".finally(() => Promise.resolve(9))"],
  ["nothing", ".then()"],
  ["no-function", ".then(5, null)"],
  ["undefined", ".then(() => {})"],
  ["nested", '.then(value => Promise.resolve(value).then(inner => {\n  note("i");\n  return inner;\n}))'],
  ["list", ".then(value => [value, value])"],
  ["counts", ".then(() => ++count)"],
  ["branch", ".then(value => (value > 1 ? [value] : value < 0 ? -1 : 0))"],
  [
    "loop",
    ".then(value => {\n  let sum = 0;\n  for (let i = 0; i < 5; i++) if (i !== 2) sum += i + (Number(value) || 0);\n  return sum;\n})",
  ],
  ["kind", '.then(value => (typeof value === "number" ? value * 2 : Array.isArray(value) ? value.length : 1))'],
];
const ends: [name: string, text: string][] = [
  ["then", 'CHAIN.then(value => note("end", show(value)), error => note("bad", error?.name ?? error));'],
  ["awaited", 'try {\n  note("end", show(await CHAIN));\n} catch (error) {\n  note("bad", error?.name ?? error);\n}'],
  [
    "awaited-later",
    'const chain = CHAIN;\nchain.catch(() => note("quiet"));\nawait null;\ntry {\n  note("end", show(await chain));\n} catch (error) {\n  note("bad", error?.name ?? error);\n}',
  ],
  [
    "all-of-them",
    'try {\n  note("end", show(await Promise.all([CHAIN, CHAIN])));\n} catch (error) {\n  note("bad", error?.name ?? error);\n}',
  ],
  [
    "branches",
    'const chain = CHAIN;\nchain.then(value => note("one", show(value)), () => note("one-bad"));\nchain.then(value => note("two", show(value)), () => note("two-bad"));',
  ],
  [
    "returned",
    'const run = async () => CHAIN;\nawait run().then(value => note("end", show(value)), error => note("bad", error?.name ?? error));',
  ],
];
const besides: [name: string, text: string][] = [
  ["nobody", ""],
  ["microtask", 'queueMicrotask(() => note("m"));'],
  ["promise", 'Promise.resolve().then(() => note("p1")).then(() => note("p2")).then(() => note("p3"));'],
  ["async", '(async () => {\n  note("s0");\n  await null;\n  note("s1");\n  await null;\n  note("s2");\n})();'],
  ["tick", 'process.nextTick(() => note("t"));'],
];
const rounds: [name: string, text: string][] = [
  ["once", "await run(1);"],
  ["in-turn", "for (let n = 0; n < 3; n++) await run(n);"],
  ["at-once", "await Promise.all([run(1), run(2), run(3)]);"],
  ["started", "run(1);\nrun(2);"],
];
const total = starts.length * links.length * links.length * ends.length * besides.length * rounds.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const start = pick(starts);
  const first = pick(links);
  const second = pick(links);
  const end = pick(ends);
  const beside = pick(besides);
  const round = pick(rounds);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const chain = `${start[1]}${first[1]}${second[1]}`;
  const lines = [
    "const notes = [];",
    "let count = 0;",
    'const show = value => (Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : String(value));',
    'const note = (...all) => void notes.push(all.map(each => (typeof each === "object" && each ? show(each) : String(each))).join("="));',
    ...(/Own/.test(start[1]) ? ["class Own extends Promise {}"] : []),
    ...(/^kept/.test(start[1]) ? ["const kept = Promise.resolve(6);"] : []),
    "async function run(n) {",
    ...(beside[1] ? [indent(beside[1], "  ")] : []),
    indent(end[1].replaceAll("CHAIN", () => chain), "  "),
    "}",
    round[1],
    'await new Promise(resolve => setImmediate(resolve));',
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${start[0]}--${first[0]}--${second[0]}--${end[0]}--${beside[0]}--${round[0]}.mjs`,
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
