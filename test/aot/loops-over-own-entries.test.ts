// `for (const [key, value] of Object.entries(object))` makes an array for each property and one for them all, only to take them apart again. Where
// the loop alone has the list, compiled code asks the run time for the keys and values in one list, and the pattern leaves nothing of the pairs.
// programs/objects/loops-over-own-entries.js holds what such loops do against plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand, withoutPass } from "./harness/flags";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, spawned } from "./run-programs";

const env = { ...bunEnv, NO_COLOR: "1" };

const program = `
function apply(node, key, value) { node.n += key.length + (typeof value === "number" ? value : 1); }
function applyAll(node, props) {
  for (const [key, value] of Object.entries(props)) apply(node, key, value);
}
const node = { n: 0 };
const many = JSON.parse('[{"a":1,"b":"x","c":3},{"style":{"x":1},"children":"t","key":4,"d":5},{"p":1,"q":2,"r":3}]');
for (let round = 0; round < 300; round++) applyAll(node, many[round % 3]);
console.log(node.n);
`;

// The text of the function of that name that is no entry or generic version of another.
function bodiesOf(dump: string, name: string): string[] {
  return dump
    .split(/^(?=function f\d+ )/m)
    .filter(text => text.startsWith("function f") && text.slice(0, text.indexOf("\n")).includes(` name="${name}" `));
}

// Compiles the program, holds what it prints against plain Bun, and answers the selected code of the function.
async function compile(source: string, name: string, flags: string[] = []): Promise<string[]> {
  using dir = tempDir("aot-loops-over-own-entries", { "main.js": source });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const command = [
    bunExe(),
    ...compileCommand,
    ...flags,
    writesProgramInto(folder),
    "main.js",
    "--outfile",
    executable,
  ];
  built(await spawned(command, folder, env));
  const plain = await spawned([bunExe(), "main.js"], folder, env);
  expect(plain.exitCode).toBe(0);
  expect(await spawned([executable], folder, env)).toEqual(plain);
  const bodies = bodiesOf(await printIR(folder, { until: "Select", flags }), name);
  expect(bodies.length).toBeGreaterThan(0);
  return bodies;
}

test("a loop over the own entries of an object nobody knows makes no pair on the heap", async () => {
  const bodies = await compile(program, "applyAll");
  for (const body of bodies) {
    expect(body).toContain(" overload=CompilerHelpersOwnEntriesFlat/");
    expect(body).not.toContain("ObjectEntries");
    expect(body.split("\n").filter(line => line.includes(" = NewArray ") && !line.includes(" storage=Frame"))).toEqual(
      [],
    );
    expect(body).not.toContain(" = DestructureIterable ");
  }
}, 300_000);

// Where flow says what the pair holds, a statement of its type stands between the pair and the reads of the pattern, and the pair stays: in the frame, stored and read back.
test.todo("a loop over the own entries of an object nobody knows makes no pair at all", async () => {
  for (const body of await compile(program, "applyAll")) expect(body).not.toContain(" = NewArray ");
});

// The slots of an object whose layout is known are read where they lie, which is cheaper than any list: the run time is not asked at all.
const programOfKnownLayout = `
function total(object) {
  let sum = 0;
  for (const [key, value] of Object.entries(object)) sum += value + key.length;
  return sum;
}
const object = { a: 1, bb: 2, ccc: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
let sum = 0;
for (let round = 0; round < 300; round++) sum += total(object);
console.log(sum);
`;

// Inlined into its only caller the function has no body left to look at, so the program is built without the inliner.
test("a loop over the own entries of an object of a known layout calls nothing", async () => {
  for (const body of await compile(programOfKnownLayout, "total", [withoutPass("InlineCalls")])) {
    expect(body).not.toContain("CompilerHelpersOwnEntriesFlat");
    expect(body).not.toContain("ObjectEntries");
    expect(body).toContain(" = GetSlot ");
  }
}, 300_000);
