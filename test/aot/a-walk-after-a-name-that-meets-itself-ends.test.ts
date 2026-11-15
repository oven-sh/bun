import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The build follows a name to the function or class that it holds: through calls, members and parameters. Here the way comes back to where it began.
const programs: Record<string, string> = {
  "a bound function bound again under its own name": `// A name holds what bind, call or apply of itself answers.
let handler = function (value) { return [this.tag, value].join(); };
handler = handler.bind({ tag: "one" });
handler = handler.bind({ tag: "two" });
var pick = function (value) { return value; };
var picked = pick.call(null, pick);
pick = pick(pick);
const holder = { run(value) { return value; } };
holder.run = holder.run(holder.run);
holder.run = holder.run.call(holder, holder.run);
console.log(handler("x"), picked === pick, holder.run(3), pick(4));
`,
  "a default parameter that calls the function itself": `// The value of a parameter that was left out is a call of the function, or of one that calls it.
function same(value = same(1)) { return value; }
function outer(value = inner()) { return value; }
function inner(value = stopAt.zero ? 7 : outer()) { return value; }
const stopAt = { zero: true };
const pass = (value = pass("end")) => value;
class Made {}
const Class = same(Made);
console.log(same(), outer(), inner(), pass(), Class === Made, new (same(Made))() instanceof Made);
`,
  "a function that calls itself and a method of the answer": `// Nothing calls the first function. The second is the same, called.
function unused(text) {
  return text.length === 0 ? text : unused(text.slice(1)).concat(text[0]);
}
function reversed(text) {
  return text.length === 0 ? text : reversed(text.slice(1)).concat(text[0]);
}
console.log(reversed("abcdef"), typeof unused);
`,
  "a member stored with what a call of its own member answers": `// The value stored under a name is a call of a member of what the name holds.
const bound = { write(text) { return this.prefix + text; }, prefix: "plain " };
bound.write = bound.write.bind({ prefix: "bound " });
const chained = { f: { g() { return { g() { return "second"; }, tag: "first" }; } } };
chained.f = chained.f.g();
const empty = {};
let thrown = "nothing";
try {
  empty.write = empty.write.bind({});
} catch (error) {
  thrown = error.name;
}
const other = {};
try {
  other.f = other.f.g();
} catch (error) {
  thrown += " " + error.name;
}
console.log(bound.write("text"), chained.f.tag, chained.f.g(), thrown);
`,
  "a method that returns what a call of itself answers": `// The recursion goes through a member of an object, of a class and of the exports.
const walker = { down(node) { return node.next ? walker.down(node.next) : node; } };
walker.again = function (node) { return node.next ? walker.again(node.next).self() : node; };
class Chain { last(node) { return node.next ? this.last(node.next) : node; } static of(node) { return node.next ? Chain.of(node.next) : node; } }
const end = { name: "end", self() { return this; } };
const list = { next: { next: end, self() { return this; } }, self() { return this; } };
console.log(walker.down(list).name, walker.again(list).name, new Chain().last(list).name, Chain.of(list).name);
`,
  "two functions that return what the other answers": `// a > b > a, each handing on what it was handed.
function a(value, depth) { return depth === 0 ? value : b(value, depth - 1); }
function b(value, depth) { return depth === 0 ? value : a(value, depth - 1); }
function first(value) { return second(value); }
function second(value) { return stop.now ? value : first(value); }
const stop = { now: true };
class Kept {}
const Same = a(Kept, 5);
const Other = first(Kept);
console.log(Same === Kept, Other === Kept, new Same() instanceof Kept, a(a, 3) === a);
`,
};
// It throws when it runs, so it is only built.
const onlyBuilt = `const bound = {};
bound.write = bound.write.bind({});
`;

for (const [name, text] of Object.entries({
  ...programs,
  "a member stored once with a call of its own member": onlyBuilt,
})) {
  test(`${name}: the build ends`, async () => {
    using dir = tempDir("aot-a-walk-that-meets-itself", { "main.js": text });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    if (text === onlyBuilt) return;
    const plain = await run([bunExe(), "main.js"], String(dir), bunEnv);
    expect(await run([executable], String(dir), bunEnv)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  }, 120_000);
}
