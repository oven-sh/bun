// A caller makes a closure or a bound function over its own locals and hands it to an async function. The async function calls it, keeps it, stores
// it, captures it, passes it on or returns it: before its first await, behind one, in a catch, in a finally or in a loop round an await. The caller
// returns first, the stack is written over and a collection runs before the async function goes on. Everything that was kept is called at the end.
import type { Random } from "./random";

const makers = [
  `join.bind(null, local)`,
  `join.bind(box, local, text)`,
  `join.bind(null, local).bind(null, text)`,
  `box.read.bind(box)`,
  `value => local + ":" + value`,
  `value => text + box.value + value`,
  `value => ++counter + ":" + value`,
  `function named(value) {\nreturn local + "/" + value;\n}`,
  `(outer => value => local + outer + value)(text)`,
  `async value => local + "~" + value`,
  `class Made {\nconstructor(value) {\nthis.value = local + value;\n}\n}`,
  `() => box`,
] as const;

const uses = [
  `log.push("call " + show(handed(1)));`,
  `log.push("twice " + show(handed(1)) + " " + show(handed(2)));`,
  `log.push("name " + typeof handed.name + " " + handed.length);`,
  `log.push("same " + (handed === handed) + " " + (handed === kept.last));`,
  `kept.last = handed;`,
  `kept.list.push(handed);`,
  `kept.map.set(kept.map.size, handed);`,
  `kept.holder.field = handed;`,
  `kept.list.push(() => handed(3));`,
  `log.push("inner " + show((() => handed(4))()));`,
  `log.push("new " + typeof new handed(5));`,
  `log.push("instanceof " + (({}) instanceof handed));`,
  `log.push("typeof " + typeof handed);`,
  `log.push("apply " + show(Reflect.apply(handed, null, [6])) + " " + show(handed.call(null, 7)) + " " + show(handed.apply(null, [8])));`,
  `log.push("bound " + show(handed.bind(null, 9)()));`,
  `log.push("mapped " + [1, 2].map(handed).map(show).join());`,
  `log.push("then " + show(await Promise.resolve(10).then(handed)));`,
  `queueMicrotask(() => log.push("job " + show(attempt(() => handed(11)))));`,
  `handed.mark = (handed.mark ?? 0) + 1;\nlog.push("mark " + handed.mark);`,
  `log.push("comma " + show((0, handed)(12)));`,
  `log.push("awaited " + show(await handed(13)));`,
  `kept.results.push(handed(14));`,
  `const result = handed(15);\nkept.list.push(() => result);`,
] as const;

const disturbances = [``, `churn(200);`, `Bun.gc(true);`, `descend(150, 1, "d");`, `descend(150, 1, "d");\nchurn(200);\nBun.gc(true);`] as const;

const forms = [
  { parameter: `handed`, first: ``, argument: (made: string) => made },
  { parameter: `handed = fallback`, first: ``, argument: (made: string) => made },
  { parameter: `{ handed }`, first: ``, argument: (made: string) => `{ handed: ${made} }` },
  { parameter: `[handed]`, first: ``, argument: (made: string) => `[${made}]` },
  { parameter: `...[handed]`, first: ``, argument: (made: string) => made },
  { parameter: `...rest`, first: `const handed = rest[0];`, argument: (made: string) => made },
  { parameter: ``, first: `const handed = arguments[1];`, argument: (made: string) => made },
  { parameter: ``, first: `const handed = fallback;`, argument: (made: string) => made },
  { parameter: `handed, count = arguments.length`, first: `log.push("count " + count);`, argument: (made: string) => made },
] as const;

const head = `const kept = { last: undefined, list: [], map: new Map(), holder: { field: undefined }, results: [] };
function show(value) {
  if (typeof value === "function") return "function";
  if (value instanceof Promise) return "promise";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
  return String(value);
}
function join(...values) {
  return (this === undefined || this === null ? "" : "this." + this.value + "|") + values.join("+");
}
function fallback(value) {
  return "fallback " + value;
}
function churn(count) {
  const junk = [];
  for (let index = 0; index < count; index++) junk.push({ index, text: "x" + index, call: () => index });
  return junk.length;
}
function descend(depth, number, text) {
  const pair = { number, text, call: () => number };
  return depth === 0 ? pair.call() : descend(depth - 1, number + 1, text) + (pair.number & 1);
}
async function tick() {
  await null;
}
async function fail() {
  await null;
  throw new Error("failed");
}
function callThrough(callee, log, argument) {
  return callee(log, argument);
}
`;

function guarded(use: string): string {
  return `try {\n${use}\n} catch (error) {\nlog.push("throws " + error.name);\n}`;
}

function callee(random: Random, index: number, count: number, parameter: string, first: string): string {
  const some = (chance: number) => (random.chance(chance) ? Array.from({ length: random.between(1, 2) }, () => guarded(random.pick(uses))) : []);
  const disturb = () => random.pick(disturbances);
  const passOn = index + 1 < count && random.chance(0.3) ? [`log.push("passed on " + show(await callee${random.between(index + 1, count - 1)}(log, passedOn(handed))));`] : [];
  const lines = [first, ...some(0.6), `await tick();`, disturb(), ...some(0.4), ...passOn];
  if (random.chance(0.4)) {
    lines.push(`try {`, ...some(0.2), `await fail();`, `} catch {`, disturb(), ...some(0.6), `}`);
    if (random.chance(0.5)) lines.splice(-1, 1, `} finally {`, ...some(0.7), `}`);
  }
  if (random.chance(0.3)) {
    const isUsedFirst = random.chance(0.5);
    lines.push(`for (let turn = 0; turn < ${random.between(1, 3)}; turn++) {`, ...(isUsedFirst ? some(0.8) : []), `await tick();`, disturb(), ...(isUsedFirst ? [] : some(0.8)), `}`);
  }
  lines.push(random.chance(0.2) ? `return handed;` : `return ${index};`);
  return `async function callee${index}(log, ${parameter}) {\n${lines.filter(line => line !== "").join("\n")}\n}`;
}

export function generate(random: Random): string {
  const form = random.pick(forms);
  const count = random.between(1, 5);
  const callees = Array.from({ length: count }, (_, index) => callee(random, index, count, form.parameter, form.first));
  const callers: string[] = [];
  const runs: string[] = [];
  const callerCount = random.between(1, 4);
  for (let index = 0; index < callerCount; index++) {
    const chosen = `callee${random.below(count)}`;
    const argument = form.argument(random.chance(0.7) ? random.pick(makers) : `made`);
    const call = random.pick([
      `${chosen}(log, ${argument})`,
      `callees[pick % callees.length](log, ${argument})`,
      `table.${chosen}(log, ${argument})`,
      `callThrough(${chosen}, log, ${argument})`,
      `(pick & 1 ? ${chosen} : callee0)(log, ${argument})`,
    ]);
    const isAsyncCaller = random.chance(0.3);
    callers.push(`${isAsyncCaller ? "async " : ""}function caller${index}(log, pick) {
const local = pick * 3 + ${index};
const text = "t" + pick;
const box = {
value: "b" + pick,
read(value) {
return this.value + "." + value;
},
};
let counter = pick;
const made = ${random.pick(makers)};
${random.pick([`return ${call};`, `const promise = ${call};\n${random.pick(disturbances)}\nreturn promise;`, ...(isAsyncCaller ? [`return await ${call};`, `const result = await ${call};\ncounter++;\nreturn result;`] : [])])}
}`);
    const times = random.weighted([[5, 1], [3, 3], [1, 200]] as const);
    runs.push(`for (let time = 0; time < ${times}; time++) {
const log = [];
const promise = caller${index}(log, time);
${random.pick(disturbances)}
const result = await promise;
${random.pick(disturbances)}
log.push("result " + show(typeof result === "function" ? attempt(() => result(30)) : result));
if (time < 3 || time === ${times - 1}) lines.push("caller ${index} time " + time + ": " + log.join(" | "));
}`);
  }
  return `${head}
function passedOn(handed) {
  return ${form.argument("handed")};
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return "throws " + error.name;
  }
}
${callees.join("\n")}
const callees = [${callees.map((_, index) => `callee${index}`).join(", ")}];
const table = { ${callees.map((_, index) => `callee${index}`).join(", ")} };
${callers.join("\n")}
const lines = [];
async function main() {
${runs.join("\n")}
descend(150, 1, "d");
churn(500);
Bun.gc(true);
await tick();
lines.push("last " + show(attempt(() => kept.last?.(20))));
lines.push("field " + show(attempt(() => kept.holder.field?.(21))));
lines.push("list " + kept.list.length + " " + kept.list.slice(0, 40).map(each => show(attempt(() => each(22)))).join(" "));
lines.push("map " + kept.map.size + " " + [...kept.map.values()].slice(0, 40).map(each => show(attempt(() => each(23)))).join(" "));
lines.push("results " + kept.results.length + " " + kept.results.slice(0, 40).map(show).join(" "));
}
main().then(
  () => console.log(lines.join("\\n")),
  error => console.log(lines.join("\\n") + "\\nmain failed " + error),
);
`;
}
