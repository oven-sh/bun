// Where the compiler holds that nothing arrives at a parameter, a read or the result of a call, the code behind it cannot be reached, and what stands there is a trap.
// That is right of dead code. It is also the form in which a missing source shows first: an operation or a built-in that hands out values which no rule of the analysis names.
//
// `--aot-check=functions-get-past-entry` names every function that is compiled and cannot get past its first block, unless it ends there in a throw that the program spells out.
// It looks before anything is inlined, since an inlined body has no first block, and reports behind the removal of what nothing names any more, so code that is dropped is not named.
// A program that is named is not wrong: a callback over a list that is always empty is dead code that nobody has called dead, and so is a read from what is always null
// or a call of what is always undefined: the language throws there, the program does not say so, and a store that the analysis missed looks the same.
// The real programs have none, so there a name is worth reading.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { test } from "./supported";

const check = "--aot-check=functions-get-past-entry";

const named: Record<string, string> = {
  "a callback over a list that is always empty": `
const list = [];
list.forEach(part => { console.log(part.name); });
console.log("end");`,
  "the same callback where its caller is inlined": `
function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i]); }
each([], part => { console.log(part.name); });
console.log("end");`,
  "a callback over a map that is always empty": `
const byName = new Map();
byName.forEach((value, name) => { console.log(value.x, name.length); });
console.log("end");`,
  "a call of what is not there": `
const o = {};
function call() { return o.absent(); }
try { call(); } catch (e) { console.log(e.name); }`,
};
const endsBehind: Record<string, string> = { "a call of what is not there": "Call" };

const passedOver: Record<string, string> = {
  "the callback over a list that holds something": `
const list = [{ name: "a" }];
list.forEach(part => { console.log(part.name); });
console.log("end");`,
  "a function that throws, and one that only calls it": `
function fail(text) { throw new Error(text); }
function refuse() { fail("no"); }
try { refuse(); } catch (e) { console.log(e.message); }`,
  "a function that nobody calls": `
function unused(x) { return x.y; }
console.log(typeof unused);`,
  "what built-ins hand out: the strings of a template, what Object.groupBy made": `
function build(strings, ...values) { let text = ""; strings.forEach((part, index) => { text += part.toUpperCase() + (values[index] ?? ""); }); return text; }
console.log(build\`ab\${1}cd\${2}ef\`);
const groups = Object.groupBy([1], () => "group");
function change(x) { Object.defineProperty(x, "added", { get() { return 7; } }); }
change(groups);
console.log(groups.added);`,
  "TypeScript: what Object.create made is held as an instance of a class": `
class Safe {}
const bare: Safe = Object.create(Safe.prototype);
function run(): number { return (bare as any).code; }
console.log("got", run());`,
};

async function build(name: string, source: string, ...flags: string[]) {
  const file = name.startsWith("TypeScript") ? "main.ts" : "main.js";
  using folder = tempDir("aot-functions-get-past-entry", { [file]: source });
  const result = await slot(() =>
    spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./" + file, "--outfile", join(String(folder), "main")],
      String(folder),
      bunEnv,
    ),
  );
  return {
    exitCode: result.exitCode,
    names: [
      ...result.stderr.matchAll(
        /FunctionEndsInFirstBlock: .*; (it ends behind \w+|it ends at once) in function .* at .*main\.[jt]s:(\d+):\d+/g,
      ),
    ].map(([, how, line]) => `${how}, line ${line}`),
  };
}

test.concurrent.each(Object.keys(named))("is named: %s", async name => {
  expect(await build(name, named[name], check)).toEqual({
    exitCode: 1,
    names: [`it ends behind ${endsBehind[name] ?? "PropGet"}, line 3`],
  });
  expect(await build(name, named[name])).toEqual({ exitCode: 0, names: [] });
});

test.concurrent.each(Object.keys(passedOver))("is passed over: %s", async name => {
  expect(await build(name, passedOver[name], check)).toEqual({ exitCode: 0, names: [] });
});
