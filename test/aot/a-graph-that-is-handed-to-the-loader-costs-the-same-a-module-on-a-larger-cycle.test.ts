import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// The last file of a long row imports a file that is missing, so the graph is handed to the loader, which gives each module a state of its own.
// Beside the row lies one cycle of ES modules. Where each state walked through every record of the cycle, the records walked grew with the square of its size.
const sizes = [100, 400];

function project(modules: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "reads.mjs": `import { v0 } from "./m0.mjs";\nimport "./row0.mjs";\nexport const seen = () => v0;\n`,
    "main.mjs": `console.log("answers", await import("./reads.mjs").catch(error => error.code));\n`,
  };
  for (let k = 0; k < 40; k++) files[`row${k}.mjs`] = `import "./${k < 39 ? `row${k + 1}` : "missing"}.mjs";\n`;
  for (let k = 0; k < modules; k++) {
    const [a, b] = [(k * 7 + 1) % modules, (k * 13 + 5) % modules];
    files[`m${k}.mjs`] =
      `import { v${a} as a } from "./m${a}.mjs";\nimport { v${b} as b } from "./m${b}.mjs";\n` +
      `export const v${k} = ${k};\nexport const sum${k} = () => a + b;\n`;
  }
  return files;
}

test.concurrent("what plain Bun answers", async () => {
  using dir = tempDir("aot-cycle-handed-to-the-loader", project(sizes[0]));
  const { stdout, exitCode } = await run([bunExe(), "./main.mjs"], String(dir), bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: "answers ERR_MODULE_NOT_FOUND\n", exitCode: 0 });
});

const walked = new Map<number, number>();

test.concurrent.each(sizes)("a cycle of %d modules", async modules => {
  using dir = tempDir("aot-cycle-handed-to-the-loader", project(modules));
  const cwd = String(dir);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "compiled.exe"],
    cwd,
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, exitCode } = await run([join(cwd, "compiled.exe")], cwd, {
    ...bunEnv,
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  expect({ stdout, exitCode }).toEqual({ stdout: "answers ERR_MODULE_NOT_FOUND\n", exitCode: 0 });
  const lines = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:RecordsForStatesOfLoads"));
  expect(lines.length).toBeGreaterThan(0);
  walked.set(
    modules,
    lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
});

test("as many records are walked for a module on a larger cycle", () => {
  const [small, large] = sizes.map(modules => walked.get(modules)! / modules);
  expect(small).toBeGreaterThanOrEqual(1);
  expect(large).toBeLessThanOrEqual(1.5 * small);
});
