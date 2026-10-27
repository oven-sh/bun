import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// The first line is the longest list that a spread hands to a function. A call that keeps one list on the stack takes nine tenths of
// it, and one that hands on what it was given keeps two.
const limits = `function count(...all) { return all.length; }
function counted(a, b) { return arguments.length; }
function sum(a, b) { return a + b; }
function forwardRest(...all) { return 1 + count(...all); }
function forwardArguments() { return 1 + count.apply(null, arguments); }
function forwardRestToNative(...all) { return 1 + Math.max(...all); }
function forwardArgumentsToNative() { return 1 + Math.max.apply(null, arguments); }
function tail(list) { "use strict"; return count(...list); }
function tailForward() { "use strict"; return count.apply(null, arguments); }
async function later(...all) { return all.length; }
function* steps(...all) { yield all.length; }
class Base { constructor(...all) { this.n = all.length; } }
class Derived extends Base { constructor(...all) { super(...all); } }
class Implicit extends Base { }
function Old() { this.n = arguments.length; }
const bound = count.bind(null, 1);
const made = new Function("...all", "return all.length");
const apply = [Function.prototype.apply][0];
const reflectApply = [Reflect.apply][0];
const reflectConstruct = [Reflect.construct][0];

const once = {
  "a spread": list => count(...list),
  "a spread, arguments": list => counted(...list),
  "a spread, parameters": list => sum(...list),
  "a spread behind an argument": list => count(0, ...list),
  "a method": list => ({ count }).count(...list),
  "apply": list => count.apply(null, list),
  "apply as a value": list => apply.call(count, null, list),
  "call": list => count.call(null, ...list),
  "Reflect.apply": list => Reflect.apply(count, null, list),
  "Reflect.apply as a value": list => reflectApply(count, null, list),
  "new": list => new Base(...list).n,
  "new of a function": list => new Old(...list).n,
  "Reflect.construct": list => Reflect.construct(Base, list).n,
  "Reflect.construct as a value": list => reflectConstruct(Base, list).n,
  "a tail call": list => tail(list),
  "an async function": list => typeof later(...list),
  "a generator": list => steps(...list).next().value,
  "holes": list => count(...new Array(list.length)),
  "an array-like": list => count.apply(null, { length: list.length }),
  "a typed array": list => count(...new Uint8Array(list.length)),
  "doubles": list => count(...list.map(x => x + 0.5)),
  "strings": list => count(...list.map(String)),
  "text made at run time": list => made(...list),
  "a native function": list => Math.max(...list),
  "push": list => [].push(...list),
};
const twice = {
  "super": list => new Derived(...list).n,
  "a class without a constructor": list => new Implicit(...list).n,
  "a rest parameter handed on": list => forwardRest(...list),
  "arguments handed on": list => forwardArguments(...list),
  "a rest parameter handed to a native function": list => forwardRestToNative(...list),
  "arguments handed to a native function": list => forwardArgumentsToNative(...list),
  "arguments handed on in a tail call": list => tailForward(...list),
  "a bound function": list => bound(...list),
};

const kept = [];
function answers(run, n) {
  try {
    kept.push(run(new Array(n).fill(1)));
    return true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return false;
  }
}
let most = 1000, tooMany = 4000000;
while (tooMany - most > 1000) {
  const middle = (most + tooMany) >> 1;
  if (answers(once["a spread"], middle)) most = middle;
  else tooMany = middle;
}
console.log(most);
for (const name in once) console.log(name, answers(once[name], Math.floor(most * 0.9)));
for (const name in twice) console.log(name, answers(twice[name], Math.floor(most * 0.45)));
console.log(kept.every(value => value === "object" || value > 0));
`;

const values = `function rest(...all) { return all.join(); }
function named(a, b, c, d, e, f, g, h, i, j, k, l, m) { return [a, b, c, d, e, f, g, h, i, j, k, l, m].slice(0, arguments.length).join() + "/" + arguments.length; }
function both(a, b, c, ...all) { return [a, b, c].join() + "|" + all.join() + "|" + this; }
class Made { constructor(...all) { this.text = all.join() + (new.target === Made); } }
class Heir extends Made { constructor(a, b, c, d, e, f, g, h, i, j) { super(a, b, c, d, e, f, g, h, i, j); this.text += [a, j, arguments.length].join(); } }
function Old(a, b, c, d, e, f, g, h, i, j) { this.text = [a, b, c, d, e, f, g, h, i, j].join() + arguments.length + (new.target === Other); }
function Other() {}
const reflectApply = [Reflect.apply][0];
const reflectConstruct = [Reflect.construct][0];
const lines = [];
for (let n = 0; n <= 24; n++) {
  const list = Array.from({ length: n }, (_, at) => "v" + at);
  lines.push(reflectApply(rest, null, list), reflectApply(named, null, list), reflectApply(both, "t", list));
  lines.push(reflectConstruct(Made, list).text, reflectConstruct(Heir, list).text, reflectConstruct(Old, list, Other).text);
  lines.push(rest.bind(null, "b")(...list), both.bind("s", "b", "c")(...list));
}
const groups = "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)";
for (let n = 1; n <= 11; n++) lines.push("abcdefghijk".replace(new RegExp(groups.slice(0, n * 3)), rest), "abcdefghijk".replace(new RegExp(groups.slice(0, n * 3), "g"), named));
let waiting = 0;
for (const n of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17]) {
  const list = Array.from({ length: n }, (_, at) => at);
  waiting += 2;
  setTimeout((...all) => { lines.push("timer " + all.join()); done(); }, 0, ...list);
  process.nextTick(function (a, b, c, d, e, f, g, h, i, j, k) { lines.push("tick " + [a, b, c, d, e, f, g, h, i, j, k].join() + arguments.length); done(); }, ...list);
}
function done() {
  if (!--waiting) console.log(lines.join("\\n"));
}
`;

async function runBothWays(text: string) {
  using dir = tempDir("a-long-list-of-arguments", { "main.js": text });
  const run = (cmd: string[]) => runCommand(cmd, String(dir));
  const plain = await run([bunExe(), "run", "main.js"]);
  expect(plain.exitCode).toBe(0);
  const build = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "compiled"]);
  expect(build.stderr).not.toContain("error");
  expect(build.exitCode).toBe(0);
  const compiled = await run([join(String(dir), "compiled")]);
  expect(compiled.exitCode).toBe(0);
  return { plain: plain.stdout, compiled: compiled.stdout };
}

describe.concurrent("an executable built with --aot answers as bun run", () => {
  test("how long a list may be", async () => {
    const { plain, compiled } = await runBothWays(limits);
    const [most, ...answers] = plain.split("\n");
    const [mostCompiled, ...answersCompiled] = compiled.split("\n");
    expect(answers.join("\n")).not.toContain("false");
    expect(answersCompiled).toEqual(answers);
    expect(Number(mostCompiled)).toBeGreaterThan(Number(most) * 0.85);
  }, 240_000);

  test("what each argument is", async () => {
    const { plain, compiled } = await runBothWays(values);
    expect(compiled).toBe(plain);
  }, 240_000);
});
