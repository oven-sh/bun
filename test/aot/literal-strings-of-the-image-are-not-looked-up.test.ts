// A string that the program itself holds is asked again and again whether it is one of the program's literal strings: wherever it reaches a place whose type is a union of literals.
// (Here the strings are the names of properties, so that the compiler does not know which string reaches which place.) The answer is in the header of the string in the image. It used to come from a cache of 256 entries by address, in which two strings that are used in turn can evict each other for ever.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported-with-counted-calls";

const groups = 64;
const namesInGroup = 8;
const rounds = 20;

const nameOf = (group: number, index: number) => `name_${group}_${index}`;
const indexes = Array.from({ length: namesInGroup }, (_, index) => index);

const declarations = Array.from({ length: groups }, (_, group) => {
  const names = indexes.map(index => JSON.stringify(nameOf(group, index)));
  return `
    type Name${group} = ${names.join(" | ")};
    const holder${group}: { name: Name${group}; stores: number } = { name: ${names[0]}, stores: 0 };
    function store${group}(value: string): void { holder${group}.name = value as Name${group}; holder${group}.stores++; }
    const given${group}: string[] = Object.keys({ ${names.map(name => name + ": 0").join(", ")} });`;
});

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "main.ts": `${declarations.join("")}
    const made = process.argv[2] === "made";
    const pass = (text: string): string => made ? text.slice(0, 4) + text.slice(4) : text;
    let last = "";
    for (let round = 0; round < ${rounds}; round++) {
      for (let index = 0; index < ${namesInGroup}; index++) {
        ${Array.from({ length: groups }, (_, group) => `store${group}(pass(given${group}[index]));`).join("\n        ")}
      }
      last += holder0.name === ${JSON.stringify(nameOf(0, namesInGroup - 1))} && holder${groups - 1}.name === ${JSON.stringify(nameOf(groups - 1, namesInGroup - 1))} ? "y" : "n";
    }
    console.log(last, holder0.stores + holder${groups - 1}.stores);
  `,
};

async function measure() {
  using dir = tempDir("aot-literal-strings-of-the-image", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    cwd,
    bunEnv,
  );
  expect({ errors: build.stderr.split("\n").filter(line => line.includes("error")), exitCode: build.exitCode }).toEqual(
    { errors: [], exitCode: 0 },
  );

  const run = async (kind: string) => {
    const path = join(cwd, "counts-" + kind);
    const ran = await spawned([executable, kind], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: path });
    expect(ran).toEqual({
      stdout: "y".repeat(rounds) + " " + 2 * rounds * namesInGroup + "\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    return entries
      .filter(([, name]) => name === "operation:operationAOTToLiteralString")
      .reduce((sum, [count]) => sum + Number(count), 0);
  };
  return { held: await run("held"), made: await run("made") };
}

describe("compile/aot/literal-strings-of-the-image", () => {
  let lookups: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    lookups = await measure();
  }, 240_000);

  // (Bun's own modules look a few strings of the process up while it starts.)
  test("strings that the program holds are never looked up", () => {
    expect(lookups.held).toBeLessThan(namesInGroup);
  });

  test("strings that are made at run time are", () => {
    expect(lookups.made).toBeGreaterThanOrEqual(rounds * groups * namesInGroup);
  });
});
