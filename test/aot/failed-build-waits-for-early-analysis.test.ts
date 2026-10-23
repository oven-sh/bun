import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawned, withoutCoreDump } from "./run-programs";
import { test } from "./supported";

const named = (prefix: string, count: number) => Array.from({ length: count }, (_, number) => prefix + number);
const importsOf = (names: string[]) => names.map(name => `import "./${name}";\n`).join("");
const declarationsOf = (name: string, count: number) =>
  named(`export const ${name}_`, count)
    .map((declaration, number) => `${declaration}: number = ${number};\n`)
    .join("");
const validModules = named("valid", 16);
const brokenModules = named("broken", 300);
const files = {
  "one-syntax-error.ts": importsOf([...validModules, brokenModules[0]]),
  "many-syntax-errors.ts": importsOf([...brokenModules, ...validModules.slice(0, 6)]),
  "missing-import.ts": importsOf([...validModules, "imports-missing-module"]),
  "imports-missing-module.ts": importsOf(["no-such-module"]),
  ...Object.fromEntries(validModules.map((name, number) => [`${name}.ts`, declarationsOf(name, (number + 1) * 500)])),
  ...Object.fromEntries(brokenModules.map(name => [`${name}.ts`, `var arg  = "\\u";\n`])),
  "build.ts": `
    let failed = 0;
    for (let round = 0; round < 6; round++) {
      for (const entrypoint of ["./one-syntax-error.ts", "./missing-import.ts"]) {
        const built = await Bun.build({ entrypoints: [entrypoint], compile: { outfile: "./program", aot: true }, throw: false });
        if (!built.success) failed++;
      }
    }
    console.log(failed, "builds failed");
  `,
};

test("Bun.build: a build that fails before the analysis keeps its sources until the early analysis has stopped reading them", async () => {
  using dir = tempDir("aot-failed-build-in-process", files);
  const ran = await spawned(withoutCoreDump([bunExe(), "build.ts"]), String(dir), bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
    stdout: "12 builds failed\n",
    exitCode: 0,
    signal: null,
  });
}, 120_000);

test("bun build: a build that fails before the analysis keeps its sources until the early analysis has stopped reading them", async () => {
  using dir = tempDir("aot-failed-build-command-line", files);
  for (let round = 0; round < 12; round++) {
    const builds = await Promise.all(
      named("./program", 8).map(outfile =>
        spawned(
          withoutCoreDump([bunExe(), "build", "--compile", "--aot", "./many-syntax-errors.ts", "--outfile", outfile]),
          String(dir),
          bunEnv,
        ),
      ),
    );
    expect(builds.map(({ exitCode, signal }) => ({ exitCode, signal }))).toEqual(
      Array(8).fill({ exitCode: 1, signal: null }),
    );
  }
}, 240_000);
