// `for (let step = generator.next(); !step.done; step = generator.next())`: next(), return() and throw() of a generator are text of the library, and a call by name is
// replaced by that text. It steps the generator with a stub that answers the value and whether the generator has ended, and makes `{ value, done }` out of the two. Where
// the stub does not step (the generator is running, has ended, or is not one of this program's) the run time answers with an object. As long as the text handed that object
// on, the result of a call was one of two objects, and a loop that only reads `value` and `done` allocated one in every turn.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const steppedByName = `
const lines = [];
function* count(limit) {
  for (let i = 0; i < limit; i++) yield i;
  return "end";
}
function* echoes() {
  let sent;
  try {
    sent = yield "ready";
    while (sent !== "stop") sent = yield "echo " + sent;
  } catch (error) {
    sent = yield "caught " + error.message;
  }
  return "stopped by " + sent;
}
function sumByNext(generator) {
  let total = 0;
  for (let step = generator.next(); !step.done; step = generator.next()) total += step.value;
  return total;
}
function drain(generator) {
  const seen = [];
  let step = generator.next();
  while (!step.done) {
    seen.push(step.value);
    step = generator.next();
  }
  seen.push(step.value);
  return seen.join();
}
function stopEarly(generator) {
  const first = generator.next();
  const last = generator.return("returned");
  return first.value + " " + first.done + " " + last.value + " " + last.done;
}
function failInside(generator) {
  generator.next();
  const caught = generator.throw(new Error("thrown"));
  return caught.value + " " + caught.done;
}
lines.push("sums: " + [sumByNext(count(0)), sumByNext(count(1)), sumByNext(count(10000))]);
lines.push("drained: " + drain(count(3)) + " | " + drain(count(0)));
lines.push("stopped early: " + stopEarly(count(3)));
lines.push("fails inside: " + failInside(echoes()));
`;

const whereTheStubDoesNotStep = `
function attempt(label, action) {
  try {
    const step = action();
    lines.push(label + ": " + String(step.value) + " " + step.done + " " + Object.keys(step) + " " + (Object.getPrototypeOf(step) === Object.prototype));
  } catch (error) {
    lines.push(label + ": threw " + String(error));
  }
}

const ended = count(1);
drain(ended);
attempt("next of one that has ended", () => ended.next("late"));
attempt("return of one that has ended", () => ended.return("late"));
attempt("throw of one that has ended", () => ended.throw(new RangeError("late")));

let running;
function* stepsItself() {
  attempt("next of one that is running", () => running.next());
  attempt("return of one that is running", () => running.return(1));
  attempt("throw of one that is running", () => running.throw(1));
  yield "went on";
}
running = stepsItself();
attempt("the step around them", () => running.next());

const theirs = require("node:vm").runInNewContext("(function* (limit) { for (let i = 0; i < limit; i++) yield 'their ' + i; return 'their end'; })");
lines.push("theirs: " + drain(theirs(2)) + " | " + stopEarly(theirs(2)));
const ourNext = Object.getPrototypeOf(count.prototype).next;
attempt("our next on their generator", () => ourNext.call(theirs(1)));
for (const receiver of [undefined, 1, {}, count, Object.create(count(1))]) attempt("our next on " + typeof receiver, () => ourNext.call(receiver));

const kept = count(2).next();
kept.more = 1;
lines.push("a result that is kept: " + JSON.stringify(kept));
`;

const print = `console.log(lines.join("\\n"));`;

// The functions written in main.cjs, which is the first module of the program.
function functionsOfProgram(dump: string) {
  const bodies = new Map<string, string[]>();
  const lines = dump.split("\n");
  for (let start = 0; start < lines.length; start++) {
    const name = lines[start].match(/^function f\d+ (?:name="([^"]*)" )?module=m0 .*\{$/);
    if (name)
      bodies.set(
        `${name[1] ?? "the module"} (${lines[start].split(" ")[1]})`,
        lines.slice(start, lines.indexOf("}", start)),
      );
  }
  return bodies;
}

async function buildAndRun(folder: string, file: string) {
  const env = { ...bunEnv, NO_COLOR: "1" };
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), file, "--outfile", "main"],
      folder,
      env,
    ),
  );
  const [compiled, plain] = await Promise.all([
    spawned([join(folder, "main")], folder, env),
    spawned([bunExe(), file], folder, env),
  ]);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  return plain.stdout;
}

test("a function that only reads value and done steps with the stub and allocates no result", async () => {
  using dir = tempDir("aot-generator-by-name", { "main.cjs": steppedByName + print });
  const folder = String(dir);
  expect(await buildAndRun(folder, "main.cjs")).toContain("sums: 0,0,49995000\n");

  const bodies = functionsOfProgram(await printIR(folder, { until: "NumberLiteralStrings" }));
  const thoseWith = (operation: string) =>
    [...bodies].filter(([, body]) => body.some(line => line.includes(operation))).map(([name]) => name);
  expect(thoseWith(" = StepGenerator ").map(name => name.split(" ")[0])).toEqual(
    expect.arrayContaining(["sumByNext", "drain"]),
  );
  expect(thoseWith(" layout=L(IteratorResult) ")).toEqual([]);
}, 240_000);

test("a generator that is running, has ended or belongs to another realm answers as in plain Bun", async () => {
  using dir = tempDir("aot-generator-by-name", { "main.cjs": steppedByName + whereTheStubDoesNotStep + print });
  expect(await buildAndRun(String(dir), "main.cjs")).toContain(
    "our next on their generator: their 0 false value,done true\n",
  );
}, 240_000);
