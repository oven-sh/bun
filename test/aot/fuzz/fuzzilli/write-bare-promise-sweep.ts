// The least programs that wait: what the first promise is, times one step, times another, times who takes the answer, times how often, with nothing beside.
//
//   bun write-bare-promise-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<source>--<step>--<step>--<taker>--<often>.mjs or .ts
//   bun write-bare-promise-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts; every promise ends by itself.
const sources: [name: string, text: string][] = [
  ["value", "Promise.resolve(i)"],
  ["rejected", "Promise.reject(new TypeError('r' + i))"],
  ["async-function", "(async () => i)()"],
  ["async-throws", "(async () => {\n  throw new RangeError('a' + i);\n})()"],
  ["awaits", "(async () => {\n  await null;\n  return i;\n})()"],
  [
    "awaits-twice",
    "(async () => {\n  const a = await i;\n  const b = await Promise.resolve(2);\n  return a + b;\n})()",
  ],
  ["constructor", "new Promise(done => done(i))"],
  ["constructor-later", "new Promise(done => Promise.resolve().then(() => done(i)))"],
  ["constructor-fails", "new Promise((done, fail) => fail(i))"],
  ["constructor-throws", "new Promise(() => {\n  throw i;\n})"],
  ["constructor-twice", "new Promise((done, fail) => {\n  done(i);\n  fail(9);\n})"],
  ["thenable", "Promise.resolve({ then: done => done('t' + i) })"],
  ["thenable-throws", "Promise.resolve({\n  then() {\n    throw 'tt';\n  },\n})"],
  ["of-promise", "Promise.resolve(Promise.resolve(i))"],
  ["without-prototype", "Promise.resolve(Object.setPrototypeOf(Promise.resolve(i), null))"],
  ["own-then", "Object.assign(Promise.resolve(i), { then: done => (done?.('own'), kept) })"],
  ["all", "Promise.all([i, Promise.resolve(i + 1), kept])"],
  ["all-settled", "Promise.allSettled([i, Promise.reject(1)])"],
  ["race", "Promise.race([Promise.resolve(i), kept])"],
  ["any", "Promise.any([Promise.reject(1), Promise.resolve(i)])"],
  [
    "with-resolvers",
    "(() => {\n  const { promise, resolve } = Promise.withResolvers();\n  resolve(i);\n  return promise;\n})()",
  ],
  ["attempt", "Promise.try(() => i)"],
  ["heir", "Mine.resolve(i)"],
  ["kept", "kept"],
  ["generator", "(async function* () {\n  yield i;\n})().next()"],
  ["undefined", "Promise.resolve()"],
  ["object", "Promise.resolve({ v: i })"],
];
// P is the promise so far.
const steps: [name: string, text: string][] = [
  ["nothing", "P"],
  ["then", "P.then(x => x)"],
  ["then-adds", "P.then(x => x + 1)"],
  ["then-of-promise", "P.then(x => Promise.resolve(x))"],
  ["then-itself", "P.then(() => kept)"],
  ["then-throws", "P.then(() => {\n  throw new EvalError('s');\n})"],
  ["then-both", "P.then(x => ['ok', x], e => ['no', e?.name ?? e])"],
  ["then-nothing", "P.then()"],
  ["then-no-function", "P.then(5, 6)"],
  ["catch", "P.catch(e => e?.name ?? e)"],
  ["catch-throws", "P.catch(e => {\n  throw e;\n})"],
  ["finally", "P.finally(() => 'ignored')"],
  ["finally-throws", "P.finally(() => {\n  throw 'f';\n})"],
  ["awaited", "(async p => await p)(P)"],
  ["returned", "(async p => p)(P)"],
  [
    "awaited-and-caught",
    "(async p => {\n  try {\n    return await p;\n  } catch (e) {\n    return 'c' + (e?.name ?? e);\n  }\n})(P)",
  ],
  ["async-handler", "P.then(async x => x)"],
  ["thenable-handler", "P.then(x => ({ then: done => done(x) }))"],
  ["resolved", "Promise.resolve(P)"],
  ["in-all", "Promise.all([P])"],
  ["bound", "P.then(Promise.resolve.bind(Promise))"],
  ["odd-handler", "P.then(() => odd)"],
  ["handler-by-resolve", "P.then(() => keep(odd))"],
  ["handler-of-own-then", "P.then(x => Object.assign(Promise.resolve(x), { then: done => done('own ' + x) }))"],
  ["handler-of-heir", "P.then(x => Mine.resolve(x))"],
  ["two-handlers", "(p => (p.then(() => order.push('1'), () => order.push('2')), p))(P)"],
  ["generator", "(async function* (p) {\n  yield p;\n})(P).next()"],
];
const takers: [name: string, text: string][] = [["await", "try {\n  out.push(show(await P));\n} catch (e) {\n  out.push('!' + show(e));\n}"], ["then", "await P.then(x => out.push(show(x)), e => out.push('!' + show(e)));"], ["settled", "const [r] = await Promise.allSettled([P]);\nout.push(r.status, show(r.value ?? r.reason));"], ["for-await", "try {\n  for await (const x of [P]) out.push(show(x));\n} catch (e) {\n  out.push('!' + show(e));\n}"], ["order", "const p = P;\norder.push('a');\nPromise.resolve().then(() => order.push('b')).then(() => order.push('c'));\nawait Promise.allSettled([p]);\norder.push('d');"], ["in-function", "await (async () => {\n  try {\n    out.push(show(await P));\n  } catch (e) {\n    out.push('!' + show(e));\n  } finally {\n    out.push('f');\n  }\n})();"]]; // prettier-ignore
const often: [name: string, text: string][] = [["once", "{\n  const i = 1;\n  TAKE\n}"], ["three", "for (let i = 0; i < 3; i++) {\n  TAKE\n}"], ["many", "for (let i = 0; i < 20; i++) {\n  TAKE\n}"], ["in-function", "async function run(i) {\n  TAKE\n}\nfor (const i of [0, 2]) await run(i);"]]; // prettier-ignore
const total = sources.length * steps.length ** 2 * takers.length * often.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const source = pick(sources);
  const first = pick(steps);
  const second = pick(steps);
  const taker = pick(takers);
  const time = pick(often);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const promise = [first, second].reduce((so, step) => step[1].replaceAll(/\bP\b/g, () => so), source[1]);
  const take = `try {\n${indent(
    taker[1].replaceAll(/\bP\b/g, () => promise),
    "  ",
  )}\n} catch (e) {\n  out.push("!!" + e?.name);\n}`;
  const uses = (word: RegExp) => word.test(promise);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "const order = [];",
    "const show = x => (x instanceof Error ? x.name : x && typeof x === 'object' ? JSON.stringify(x, (key, y) => (y instanceof Error ? y.name : y instanceof Promise ? 'P' : y)) : String(x));",
    ...(uses(/\bkept\b/) ? ["const kept = Promise.resolve('kept');"] : []),
    ...(uses(/\bodd\b/) ? ["const odd = Object.setPrototypeOf(Promise.resolve('odd'), null);"] : []),
    ...(uses(/\bkeep\(/) ? ["const keep = Promise.resolve.bind(Promise);"] : []),
    ...(uses(/Mine/) ? ["class Mine extends Promise {}"] : []),
    within(time[1], "TAKE", take),
    "await null;",
    "await null;",
    "console.log(out.join(' ').slice(0, 900), order.join(''));",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${source[0]}--${first[0]}--${second[0]}--${taker[0]}--${time[0]}.${isTyped ? "ts" : "mjs"}`,
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
