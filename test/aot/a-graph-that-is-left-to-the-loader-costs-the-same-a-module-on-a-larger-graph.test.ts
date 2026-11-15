import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// back.cjs requires m0.mjs while it is loaded as a part of m0's own graph, so the whole graph is left to the loader, which gives each module a state of its own.
// Where each state walks through every record that is still being loaded, the records walked grow with the square of the graph.
// The counter counts walks. On the barrel plain Bun's steps grow with the square too (each module's state waits for every module that is still to come): a cheaper walk alone does not mend that.
const sizes = [100, 400];

const shapes: Record<string, (k: number, modules: number) => number[]> = {
  "a ring, both ways round": (k, modules) => [(k + 1) % modules, (k + modules - 1) % modules],
  "a barrel and the modules that import it": (k, modules) =>
    k ? [0] : Array.from({ length: modules - 1 }, (_, i) => i + 1),
  "a cycle with two ways on from each module": (k, modules) => [(k * 7 + 1) % modules, (k * 13 + 5) % modules],
};

function project(shape: string, modules: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "back.cjs": `exports.seen = typeof require("./m0.mjs");\n`,
    "main.mjs": `console.log("answers", (await import("./m0.mjs")).v0);\n`,
  };
  for (let k = 0; k < modules; k++)
    files[`m${k}.mjs`] =
      shapes[shape](k, modules)
        .map(to => `import "./m${to}.mjs";\n`)
        .join("") +
      (k === modules >> 1 ? `import "./back.cjs";\n` : "") +
      `export const v${k} = ${k};\n`;
  return files;
}

const cases = Object.keys(shapes).flatMap(shape => sizes.map(modules => [shape, modules] as const));
const walked = new Map<string, number>();

test.concurrent.each(Object.keys(shapes))("what plain Bun answers: %s", async shape => {
  using dir = tempDir("aot-graph-left-to-the-loader", project(shape, sizes[0]));
  const { stdout, exitCode } = await run([bunExe(), "./main.mjs"], String(dir), bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: "answers 0\n", exitCode: 0 });
});

test.concurrent.each(cases)("%s of %d modules", async (shape, modules) => {
  using dir = tempDir("aot-graph-left-to-the-loader", project(shape, modules));
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
  expect({ stdout, exitCode }).toEqual({ stdout: "answers 0\n", exitCode: 0 });
  const lines = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:RecordsForStatesOfLoads"));
  expect(lines.length).toBeGreaterThan(0);
  walked.set(
    `${shape} ${modules}`,
    lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
});

// `failing`: today such a graph takes every step as plain Bun takes it, for the order of the bodies, and costs what it costs there. It turns red the day the records are walked once a load. Then it is a plain test.
for (const shape of Object.keys(shapes))
  test.failing(`as many records are walked for a module on a larger graph: ${shape}`, () => {
    const [small, large] = sizes.map(modules => walked.get(`${shape} ${modules}`)! / modules);
    expect(small).toBeGreaterThanOrEqual(1);
    expect(large).toBeLessThanOrEqual(1.5 * small);
  });
