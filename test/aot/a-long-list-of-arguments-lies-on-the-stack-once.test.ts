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
const end = process.argv.length > 99 ? "x" : ";";
const spreads = new Function("f", "list", "return 1 + f(...list)" + end);
const spreadsBehindAnArgument = new Function("f", "list", "return 1 + f(0, ...list)" + end);
const applies = new Function("f", "list", "return 1 + f.apply(null, list)" + end);
const tailCalls = new Function("f", "list", "'use strict'; return f(...list)" + end);
const constructs = new Function("f", "list", "return new f(...list).n" + end);
const MadeHeir = new Function("Base", "return class extends Base { constructor(...all) { super(...all); } }" + end)(Base);
const MadeImplicit = new Function("Base", "return class extends Base { }" + end)(Base);
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
  "a spread in text made at run time": list => spreads(count, list),
  "a spread in text, arguments": list => spreads(counted, list),
  "a spread in text, parameters": list => spreads(sum, list),
  "a spread in text behind an argument": list => spreadsBehindAnArgument(count, list),
  "apply in text": list => applies(count, list),
  "a tail call in text": list => tailCalls(count, list),
  "new in text": list => constructs(Base, list),
  "new of a function in text": list => constructs(Old, list),
  "a generator called by text": list => tailCalls(steps, list).next().value,
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
  "a bound function called by text": list => spreads(bound, list),
  "super below new in text": list => constructs(Derived, list),
  "a class without a constructor below new in text": list => constructs(Implicit, list),
  "super in text": list => new MadeHeir(...list).n,
  "a class without a constructor in text": list => new MadeImplicit(...list).n,
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
function Target(a, b, c, d, e, f, g, h, i, j) { this.text = [a, b, c, d, e, f, g, h, i, j].join() + arguments.length + (new.target === Target); }
function fails(...all) { throw new RangeError(all.join()); }
const { hops, bounce } = class {
  static hops(next, ...all) { return next(...all); }
  static bounce(self, next, n, ...all) { return bounces(self, next, n - 1, ...all); }
};
const reflectApply = [Reflect.apply][0];
const reflectConstruct = [Reflect.construct][0];
const end = process.argv.length > 99 ? "x" : ";";
const spreads = new Function("f", "self", "list", "const before = list.length, kept = 'k' + before; const result = f.call(self, ...list); return [result, before, kept].join(';')" + end);
const constructs = new Function("f", "list", "const kept = 'k' + list.length; return new f(...list).text + kept" + end);
const catches = new Function("f", "list", "const kept = 'k' + list.length; try { return f(...list); } catch (error) { return error.message + kept; }" + end);
const joins = new Function("...all", "return all.join() + '/' + all.length" + end);
function ping(pong, n, a, b, c, d, e, f, g, h, i) { "use strict"; return n ? pong(pong, ping, n - 1, a, b, c, d, e, f, g, h, i) : [a, b, c, d, e, f, g, h, i].join(); }
const pong = new Function("pong", "ping", "n", "a", "b", "c", "d", "e", "f", "g", "h", "i", "'use strict'; return ping(pong, n, a, b, c, d, e, f, g, h, i)" + end);
const lines = [ping(pong, 300000, 1, 2, 3, 4, 5, 6, 7, 8, 9)];
for (let n = 0; n <= 24; n++) {
  const list = Array.from({ length: n }, (_, at) => "v" + at);
  const written = list.map((_, at) => "list[" + at + "]").join();
  const calls = new Function("f", "list", "const kept = 'k' + list.length; return f(" + written + ") + kept");
  const news = new Function("f", "list", "const kept = 'k' + list.length; return new f(" + written + ").text + kept");
  lines.push(spreads(rest, null, list), spreads(named, null, list), spreads(both, "t", list), calls(rest, list), calls(named, list));
  lines.push(constructs(Made, list), constructs(Heir, list), constructs(Old, list), constructs(Target, list), news(Made, list), news(Heir, list), news(Target, list));
  lines.push(catches(fails, list), spreads(hops, null, [joins, ...list]));
  if (n) lines.push(calls(hops, [joins, ...list].slice(0, n)));
  lines.push(reflectApply(rest, null, list), reflectApply(named, null, list), reflectApply(both, "t", list));
  lines.push(reflectConstruct(Made, list).text, reflectConstruct(Heir, list).text, reflectConstruct(Old, list, Other).text);
  lines.push(rest.bind(null, "b")(...list), both.bind("s", "b", "c")(...list));
}
function digest(...all) { let sum = 0; for (let at = 0; at < all.length; at++) sum = (sum * 31 + all[at]) % 1000003; return [this, all.length, all[0], all[all.length - 1], sum].join(); }
function digestArguments(a, b, c, d, e, f, g, h, i, j) { let sum = 0; for (let at = 0; at < arguments.length; at++) sum = (sum * 31 + arguments[at]) % 1000003; return [a, b, c, d, e, f, g, h, i, j, arguments.length, sum].join(); }
function failsWithDigest(...all) { throw new RangeError(digest.apply("thrown", all)); }
class Digest { constructor(...all) { this.text = digest.apply(new.target === Digest, all); } }
class DigestHeir extends Digest { constructor(a, ...all) { super(a, ...all); this.text += a; } }
function OldDigest(a, b, c, d, e, f, g, h, i, j) { this.text = digestArguments.apply(null, arguments) + (new.target === OldDigest); }
const digests = new Function("...all", "let sum = 0; for (const value of all) sum = (sum * 31 + value) % 1000003; return all.length + ',' + sum" + end);
const bounces = new Function("return class { static bounces(self, next, n, ...all) { return n ? self(self, next, n, ...all) : next(...all); } }.bounces" + end)();
for (const n of [4090, 4091, 4092, 4093, 4094, 4095, 4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103, 4104, 4105, 4106, 5000, 5001, 70001]) {
  const list = Array.from({ length: n }, (_, at) => at * 7 % 1009);
  lines.push(spreads(digest, "s", list), spreads(digestArguments, null, list), catches(failsWithDigest, list), spreads(hops, null, [digests, ...list]));
  lines.push(constructs(Digest, list), constructs(DigestHeir, list), constructs(OldDigest, list));
}
lines.push(bounce(bounce, digests, 3000, ...Array.from({ length: 4000 }, (_, at) => at % 89)), bounce(bounce, digests, 60, ...Array.from({ length: 6000 }, (_, at) => at % 89)));
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
