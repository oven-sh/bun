import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

function splitIntoFunctions(name: string, parameters: string, statements: string[]) {
  const functions: string[] = [];
  for (let first = 0; first < statements.length; first += 200)
    functions.push(`function ${name}${first}(${parameters}) { ${statements.slice(first, first + 200).join(" ")} }`);
  return functions;
}

// Classes hold arrow functions in their fields, and functions whose parameter takes any object store into properties of the same names.
function writeProgram(
  fieldCount: number,
  fieldsInClass: number,
  storesPerField: number,
  keyOf: (field: number) => string,
) {
  const classes: string[] = [];
  const allocations: string[] = [];
  for (let first = 0; first < fieldCount; first += fieldsInClass) {
    const fields = Array.from(
      { length: fieldsInClass },
      (_, index) => `${keyOf(first + index)} = () => this.kept + ${index};`,
    );
    classes.push(
      `class Holder${first} { kept: number; ${fields.join(" ")} constructor(kept: number) { this.kept = kept; } }`,
    );
    allocations.push(
      `{ const holder = new Holder${first}(1); holders.push(holder); sum += holder.${keyOf(first)}(); }`,
    );
  }
  const stores = Array.from(
    { length: fieldCount * storesPerField },
    (_, index) => `o.${keyOf(index % fieldCount)} = v;`,
  );
  const allocating = splitIntoFunctions("allocate", "", allocations);
  const storing = splitIntoFunctions("store", "o: any, v: () => number", stores);
  const namesOf = (functions: string[]) => functions.map(text => text.slice("function ".length, text.indexOf("(")));
  return [
    ...classes,
    "const holders: object[] = [];",
    "let sum = 0;",
    ...allocating,
    ...storing,
    'const bag = JSON.parse("{}");',
    `for (const allocate of [${namesOf(allocating).join(", ")}]) allocate();`,
    `for (const store of [${namesOf(storing).join(", ")}]) store(bag, () => 2);`,
    "console.log(sum, holders.length, Object.keys(bag).length);",
  ].join("\n");
}

async function processorSecondsOfBuild(program: string) {
  using dir = tempDir("aot-many-stores-by-name", { "main.ts": program, "tsconfig.json": "{}" });
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "./main"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([built.stdout.text(), built.stderr.text(), built.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

// Four times the program takes four times as long where the time is linear, and sixteen times as long where it is quadratic.
async function expectLinearBuildTime(name: string, few: number, writeProgramOfSize: (fieldCount: number) => string) {
  const growth = await measureUntilWithinBounds(
    name,
    async () => {
      const withFew = await processorSecondsOfBuild(writeProgramOfSize(few));
      const withMany = await processorSecondsOfBuild(writeProgramOfSize(4 * few));
      return withMany / withFew;
    },
    growth => growth < 6,
  );
  expect(growth).toBeLessThan(6);
}

test("build time is linear in the number of stores by name into any object when every field has its own name", async () => {
  await expectLinearBuildTime("fields with their own names", isSlowBuild ? 100 : 2_000, fieldCount =>
    writeProgram(fieldCount, 20, 40, field => `m${field}`),
  );
}, 240_000);

test("build time is linear in the number of stores by name into any object when every field has the same name", async () => {
  await expectLinearBuildTime("fields with the same name", isSlowBuild ? 100 : 2_000, fieldCount =>
    writeProgram(fieldCount, 1, 20, () => "m"),
  );
}, 240_000);
