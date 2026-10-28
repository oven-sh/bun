// A member that a type declares and no code names has no place in the object. A store that finds the name at run time gives the object the property all the same, and whoever lists the keys finds it where plain Bun has it:
// in front of, between and behind the members that the code does name.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { buildFlags, compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const sources = {
  "main.ts": `
interface RecordO1 {
  firstO2?: number;
  neverNamedO3?: string;
  lastO4?: number;
}
class InstanceO5 {
  firstO2?: number;
  lastO4?: number;
}
type Holder = RecordO1 | InstanceO5;
const nameFromOutside = process.argv[2];
const objectFromOutside = JSON.parse(process.argv[3]);
function store(holder: Holder, value: unknown): void {
  (holder as Record<string, unknown>)[nameFromOutside] = value;
}
function show(label: string, holder: Holder): void {
  const inLoop: string[] = [];
  for (const key in holder) inLoop.push(key);
  console.log(
    label,
    Object.keys(holder).join(),
    inLoop.join(),
    JSON.stringify(holder),
    JSON.stringify({ ...holder }),
    JSON.stringify(structuredClone({ ...holder })),
    Object.entries(holder).join(";"),
    Reflect.ownKeys(holder).join(),
    JSON.stringify(Object.assign({}, holder)),
    nameFromOutside in holder,
    (holder as Record<string, unknown>)[nameFromOutside],
  );
}
function run(kind: string, make: () => Holder): void {
  const inFront = make();
  store(inFront, "x");
  inFront.firstO2 = 1;
  inFront.lastO4 = 2;
  show(kind + " in front", inFront);

  const between = make();
  between.firstO2 = 1;
  store(between, "x");
  between.lastO4 = 2;
  show(kind + " between", between);

  const behind = make();
  behind.firstO2 = 1;
  behind.lastO4 = 2;
  store(behind, "x");
  show(kind + " behind", behind);

  const again = make();
  again.firstO2 = 1;
  store(again, "x");
  again.lastO4 = 2;
  delete (again as Record<string, unknown>)[nameFromOutside];
  show(kind + " deleted", again);
  store(again, "y");
  show(kind + " stored again", again);

  const assigned = make();
  assigned.firstO2 = 1;
  Object.assign(assigned, objectFromOutside);
  assigned.lastO4 = 2;
  show(kind + " assigned", assigned);

  const spread: Holder = { firstO2: 1, ...objectFromOutside, lastO4: 2 };
  show(kind + " spread", spread);
}
run("record", () => ({}));
run("instance", () => new InstanceO5());
const literal: RecordO1 = { firstO2: 1, lastO4: 2 };
store(literal, "x");
show("literal", literal);
`,
};

const spell = (...parts: string[]) => parts.join("");

describe("compile/aot/order of members stored from outside", () => {
  const folder = String(tempDir("aot-order-of-members-stored-from-outside", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  let bytes = Buffer.alloc(0);
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    const command = [bunExe(), ...compileCommand, buildFlags.withoutFunctionSource];
    built(await spawned([...command, "./main.ts", "--outfile", executable], folder, bunEnv));
    bytes = readFileSync(executable);
  }, 300_000);

  test.each([
    ["a name that a type declares and no code names", spell("neverNamed", "O3")],
    ["a name that no type declares", spell("undeclared", "O6")],
    ["a name that the code names", spell("last", "O4")],
    ["an index", "7"],
  ])("the keys are in the order of plain Bun with %s", async (_, name) => {
    const json = JSON.stringify({ [name]: "z", [spell("other", "O7")]: 1 });
    const commands = [[executable], [bunExe(), "run", "./main.ts"]];
    const [compiled, plain] = await Promise.all(
      commands.map(command => spawned([...command, name, json], folder, bunEnv)),
    );
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled.stdout.split("\n").length).toBe(16);
  });

  test("the executable does not hold the name that no code names", () => {
    expect(bytes.includes("neverNamedO3", 0, "latin1")).toBe(false);
    expect(bytes.includes("firstO2", 0, "latin1")).toBe(true);
  });
});
