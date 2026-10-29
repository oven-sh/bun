// The result of an awaited step of an async generator is used behind a test of that result: what a pattern asks first, `?.`, `== null`, `&&`,
// typeof. A program draws one use, one kind of generator, one way to take the step (next, return, through a promise, by call) and where the use
// stands: at the top of the module, in a function, or in a function that is called often.
import type { Random } from "./random";

// STEP stands for the awaited step. Each use ends in calls of show().
const uses = {
  "rest": `const { value, ...rest } = STEP; show(value); show(rest);`,
  "rest-alone": `const { ...rest } = STEP; show(rest);`,
  "done-and-rest": `const { done, ...rest } = STEP; show(done); show(rest);`,
  "both-and-rest": `const { value, done, ...rest } = STEP; show(value); show(done); show(rest);`,
  "both": `const { value, done } = STEP; show(value); show(done);`,
  "default": `const { value = "default", done = "default" } = STEP; show(value); show(done);`,
  "another-member": `const { value, other } = STEP; show(value); show(other);`,
  "another-member-with-default": `const { other = "default", value } = STEP; show(other); show(value);`,
  "computed-key": `const key = keys[0]; const { [key]: found, ...rest } = STEP; show(found); show(rest);`,
  "quoted-key": `const { "value": found, "done": ended } = STEP; show(found); show(ended);`,
  "nested": `const { value: { a, ...more } = { a: "none" }, ...rest } = STEP; show(a); show(more); show(rest);`,
  "assigned-pattern": `let value, rest; ({ value, ...rest } = STEP); show(value); show(rest);`,
  "parameter-pattern": `const take = ({ value, ...rest }) => { show(value); show(rest); }; take(STEP);`,
  "optional-value": `const result = STEP; show(result?.value); show(result?.done);`,
  "optional-other": `const result = STEP; show(result?.other); show(result?.value);`,
  "optional-call": `const result = STEP; show(result?.hasOwnProperty("value")); show(result?.toString());`,
  "loose-null": `const result = STEP; if (result == null) show("nothing"); else { show(result.value); show(Object.keys(result)); }`,
  "loose-null-reads-alone": `const result = STEP; if (result == null) show("nothing"); else { show(result.value); show(result.done); }`,
  "strict-undefined": `const result = STEP; if (result !== undefined) { show(JSON.stringify(result)); } else show("nothing");`,
  "strict-null": `const result = STEP; if (result === null) show("nothing"); else show({ ...result });`,
  "and": `const result = STEP; show(result && result.value); show(result && Object.getPrototypeOf(result) === Object.prototype);`,
  "or": `const result = STEP || { value: "none" }; show(result.value); show(Reflect.ownKeys(result));`,
  "coalesce": `const result = STEP ?? { value: "none" }; show(result.value); show(Object.entries(result));`,
  "typeof": `const result = STEP; if (typeof result === "object" && result !== null) { show(result.value); show("done" in result); show("next" in result); }`,
  "handed-on": `const result = STEP; if (result != null) handOn(result);`,
  "kept": `const result = STEP; if (result != null) kept.push(result); show(kept.length); show(kept[0]); show(kept[0] === result);`,
  "returned": `const asked = async () => { const result = STEP; if (result == null) return "nothing"; return result; }; show(await asked());`,
  "stored-into": `const result = STEP; if (result != null) { result.value = "stored"; result.more = 1; show(result); }`,
  "deleted-from": `const result = STEP; if (result != null) { show(delete result.done); show(result); }`,
  "is-it-the-generator": `const result = STEP; if (result != null) { show(result === generator); show(typeof result.next); show(Symbol.asyncIterator in result); }`,
  "two-ways-in": `let result; if (keys.length > 1) result = STEP; else result = { value: "other way", done: "?" }; const { value, ...rest } = result; show(value); show(rest);`,
  "two-steps-one-pattern": `const result = keys.length > 5 ? await generator.next() : STEP; const { value, ...rest } = result; show(value); show(rest);`,
  "in-a-loop": `for (let turn = 0; turn < 3; turn++) { const { value, ...rest } = STEP; show(value); show(rest); }`,
  "while-not-done": `let result, turns = 0; while ((result = STEP) != null && !result.done && turns++ < 4) { const { value, ...rest } = result; show(value); show(rest); }`,
  "in-a-try": `try { const { value, ...rest } = STEP; show(value); show(rest); } catch (error) { show("caught " + error); } finally { show("finally"); }`,
  "array-pattern-around": `const [{ value, ...rest }] = [STEP]; show(value); show(rest);`,
  "for-in": `const result = STEP; if (result != null) for (const key in result) show(key);`,
  "frozen": `const result = STEP; if (result != null) { show(Object.isFrozen(result)); show(Object.isExtensible(result)); show(Object.getOwnPropertyDescriptor(result, "value")); }`,
};

const kinds = {
  "numbers": `async function* make() { yield 1; yield 2; yield 3; return "end"; }`,
  "objects-with-value-and-done": `async function* make() { yield { value: "inner", done: "inner done", a: 1, b: 2 }; yield { a: 3, c: 4 }; return { a: 5 }; }`,
  "nothing": `async function* make() { yield undefined; yield null; yield; }`,
  "ends-at-once": `async function* make() { return "only"; }`,
  "promises": `async function* make() { yield Promise.resolve({ a: "awaited", z: 1 }); yield Promise.resolve(7); }`,
  "delegates": `async function* inner() { yield { a: "from inner", q: 1 }; return "inner end"; } async function* make() { const got = yield* inner(); yield got; }`,
  "delegates-to-sync": `function* inner() { yield { a: "sync", q: 1 }; yield 2; } async function* make() { yield* inner(); }`,
  "method": `const holder = { async *make() { yield { a: "method", m: 1 }; yield 2; } }; const make = () => holder.make();`,
  "takes-what-is-sent": `async function* make() { let sent = yield { a: "first" }; while (true) sent = yield { a: sent, sent }; }`,
};

const steps = {
  "next": `(await generator.next())`,
  "next-with-argument": `(await generator.next("sent"))`,
  "return": `(await generator.return({ a: "returned", r: 1 }))`,
  "promise-first": `(await promised())`,
  "by-call": `(await generator.next.call(generator))`,
  "second-step": `(await (await generator.next(), generator.next()))`,
};

const homes = {
  "top": (body: string) => body,
  "function": (body: string) => `async function run() { ${body} }\nawait run();`,
  "called-often": (body: string) =>
    `async function run(quietly) { quiet = quietly; ${body} }\nfor (let turn = 0; turn < 40; turn++) { generator = make(); kept.length = 0; await run(turn < 39); }`,
};

export function generate(random: Random): string {
  const text = random.pick(Object.values(uses));
  const declaration = random.pick(Object.values(kinds));
  const call = random.pick(Object.values(steps));
  const wrap = random.pick(Object.values(homes));
  return `let quiet = false;
function show(value) {
  if (quiet) return;
  let text;
  try {
    text = typeof value === "object" && value !== null ? JSON.stringify(value) + " " + Reflect.ownKeys(value).map(String).join() : String(value);
  } catch (error) {
    text = "throws " + error.name;
  }
  console.log(text);
}
const keys = JSON.parse('["value", "done"]');
const kept = [];
function handOn(result) {
  show(Object.keys(result));
  show(result.value);
}
${declaration}
let generator = make();
const promised = () => generator.next();
${wrap(text.replaceAll("STEP", call))}
export {};
`;
}
