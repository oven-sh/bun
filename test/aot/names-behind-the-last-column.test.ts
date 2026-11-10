import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// The table of lookups has a column for 65,534 names. A program that mentions more has names without one, and an access under such a name leaves the
// stub that every access calls for the hashed table. Only a large program walks that road by itself, so this one mentions 70,000 names.
// The names are taken in an order that no program chooses. These four stand among the last of a00 .. a069999.
const namesThatStandLate = ["a010060", "a010218", "a01048", "a010548"];
const namesOfCompany = 70_000;
const readsInOneFunction = 1_000;

function company() {
  const names = Array.from({ length: namesOfCompany }, (_, index) => `a0${index}`).filter(
    name => !namesThatStandLate.includes(name),
  );
  const functions: string[] = [];
  for (let first = 0; first < names.length; first += readsInOneFunction) {
    const reads = names.slice(first, first + readsInOneFunction).map(name => `o.${name};`);
    functions.push(`o => { ${reads.join(" ")} }`);
  }
  return `globalThis.frame = [\n${functions.join(",\n")},\n];\n`;
}

// Reads, calls, stores, definitions, deletions, `in`, accessors and `super`, in a loop and once, off objects of classes, records, an object without a
// prototype, a list, a text, a number and a Map.
const main = `
import "./company.js";
class Base {
  constructor() { this.a010060 = 1; }
  a010218(step) { return this.a010060 + step; }
  get a01048() { return this.a010060 * 2; }
  set a01048(value) { this.a010060 = value; }
}
class Heir extends Base {
  a010218(step) { return super.a010218(step) * 10; }
  get a01048() { return super.a01048 + 1; }
  set a01048(value) { super.a01048 = value + 1; }
}
function plain(value) { return { a010060: value, a010218: step => value - step }; }
const said = [];
const things = [new Base(), new Heir(), plain(5), Object.assign(Object.create(null), { a010060: 7 }), [1, 2], "text", 3, new Map()];
for (let turn = 0; turn < 40; turn++) {
  for (const thing of things) {
    let line = typeof thing.a010060 + ":" + thing.a010060;
    if (typeof thing.a010218 === "function") line += " " + thing.a010218(turn);
    line += " " + thing.a01048 + " " + (typeof thing === "object" ? "a010548" in thing : "-");
    if (typeof thing === "object") {
      thing.a010548 = turn;
      thing.a01048 = turn;
      line += " " + thing.a010548 + " " + Object.keys(thing).length;
      if (turn % 3 === 0) line += " " + delete thing.a010548;
    }
    if (turn % 13 === 0) said.push(line);
  }
}
const once = { a010548: "once" };
once.a010218 = "stored once";
Object.defineProperty(once, "a01048", { get() { return this.a010548 + "!"; }, enumerable: true });
said.push(JSON.stringify(once), once.a01048, String(globalThis.frame.length));
try { null.a010060; } catch (error) { said.push(error instanceof TypeError); }
try { undefined.a010218(); } catch (error) { said.push(error instanceof TypeError); }
console.log(said.join("\\n"));
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("accesses under names that have no column answer as plain Bun does", async () => {
  using dir = tempDir("aot-names-behind-the-last-column", { "main.js": main, "company.js": company() });
  const folder = String(dir);
  const executable = join(folder, "compiled" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], folder);
  expect({
    errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({
    errors: [],
    exitCode: 0,
  });
  const [plain, compiled] = await Promise.all([run([bunExe(), "run", "./main.js"], folder), run([executable], folder)]);
  expect(plain.stdout.split("\n").length).toBeGreaterThan(30);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    exitCode: plain.exitCode,
  });
});
