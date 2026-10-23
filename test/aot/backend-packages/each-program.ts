import { expect } from "bun:test";
import { beforeAll, describe, test } from "../supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "../harness/run";

const shipsNoBuildForThisPlatform = ["win32-arm64", "darwin-x64"].includes(`${process.platform}-${process.arch}`) ? ["argon2"] : [];

function testEachProgram(
  folder: string,
  part: number,
  parts: number,
  needsTheDisk: Record<string, string>,
  given: Record<string, string[]> = {},
  prepare: string[][] = [],
  withoutExceptionValidation: string[] = [],
  /** Why the executable prints something else than plain Bun, on purpose. It still has to run to its end. */
  differs: Record<string, string> = {},
  form: "in place" | "one file" = "in place",
) {
  const programs = readdirSync(join(import.meta.dir, folder))
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.startsWith("fake_") && !file.startsWith("lib_"))
    .map(file => file.slice(0, -".ts".length))
    .sort()
    .filter((program, index) => (form === "in place" ? index % parts === part - 1 : program in given));

  const dir = tempDir(`aot-backend-${folder}`, {});
  const project = join(String(dir), "project");

  async function run(cmd: string[], env: Record<string, string | undefined> = bunEnv) {
    const { stdout, stderr, exitCode } = await runCommand(cmd, project, env);
    return { stdout, stderr, exitCode };
  }

  const steady = (text: string) =>
    text
      .split("\n")
      .filter(line => !line.startsWith("TIME "))
      .join("\n")
      .replaceAll(project, "<project>")
      .replace(/\/\$bunfs\/root|B:[\\/]~BUN[\\/]root/g, "<project>")
      .replace(/took [0-9.]+m?s/g, "took N ms");

  describe(form === "in place" ? folder : `${folder}, as one file`, () => {
    beforeAll(async () => {
      cpSync(join(import.meta.dir, folder), project, { recursive: true });
      const packages = join(project, "node_modules");
      const installed = process.env.BUN_TEST_AOT_BACKEND_PACKAGES;
      if (installed) {
        expect((await run(["cp", "-R", join(installed, folder, "node_modules"), packages])).exitCode).toBe(0);
      } else {
        const { stderr, exitCode } = await run([bunExe(), "install", "--ignore-scripts", "--linker", "hoisted"]);
        expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      }
      symlinkSync(join(import.meta.dir, "..", "..", "..", "packages", "bun-types"), join(packages, "@types", "bun"));
      for (const command of prepare) {
        // `prisma generate` downloads a schema engine, which it does not run, unless it is told where one lies.
        const { stdout, stderr, exitCode } = await run([bunExe(), "--bun", ...command], { ...bunEnv, PRISMA_SCHEMA_ENGINE_BINARY: bunExe() });
        expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
      }
    }, 600_000);

    for (const program of programs) {
      test.skipIf(shipsNoBuildForThisPlatform.includes(program))(
        program,
        async () => {
          const env = withoutExceptionValidation.includes(program) ? { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined } : bunEnv;
          const plain = await run([bunExe(), "run", `./${program}.ts`], env);
          expect(plain.stdout).toContain("\nDONE");
          const executable = join(String(dir), program);
          const built = await run([bunExe(), "build", "--compile", "--aot", ...(form === "in place" ? ["--compile-in-place"] : []), `./${program}.ts`, ...(given[program] ?? []), "--outfile", executable]);
          expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({ output: "", exitCode: 0 });
          const compiled = await run([executable], env);
          if (program in differs) return void expect({ isDone: compiled.stdout.includes("\nDONE"), exitCode: compiled.exitCode, stderr: compiled.exitCode ? compiled.stderr : "" }).toEqual({ isDone: true, exitCode: 0, stderr: "" });
          expect({ stdout: steady(compiled.stdout), exitCode: compiled.exitCode, stderr: compiled.exitCode === plain.exitCode ? "" : compiled.stderr }).toEqual({ stdout: steady(plain.stdout), exitCode: plain.exitCode, stderr: "" });
          if (program in needsTheDisk) return;

          const movedAway = join(String(dir), "moved-away");
          renameSync(project, movedAway);
          mkdirSync(project);
          try {
            const alone = await run([executable], env);
            expect({ stdout: steady(alone.stdout), exitCode: alone.exitCode, stderr: alone.exitCode === plain.exitCode ? "" : alone.stderr }).toEqual({ stdout: steady(plain.stdout), exitCode: plain.exitCode, stderr: "" });
          } finally {
            rmSync(project, { recursive: true, force: true });
            renameSync(movedAway, project);
          }
        },
        600_000,
      );
    }
  });
}

export const testPrograms = (part: number, parts: number, form: "in place" | "one file" = "in place") =>
  testEachProgram(
    "programs",
    part,
    parts,
    {
      sequelize: "a driver that is required by a computed name: the name of the package is looked up on the disk",
      sequelize_named: "a driver that is required by a computed name: the name of the package is looked up on the disk",
      typeorm: "a driver that is required by a computed name: the name of the package is looked up on the disk",
    },
    {
      // A driver that is required by a computed name is found where it is an entry point.
      sequelize: ["node_modules/pg/lib/index.js"],
      sequelize_named: ["node_modules/pg/lib/index.js"],
      typeorm: ["node_modules/sql.js/dist/sql-wasm.js", "--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
      argon2: ["--asset", "node_modules/argon2/prebuilds"],
      bcrypt: ["--asset", "node_modules/bcrypt/prebuilds"],
      newrelic: ["node_modules/newrelic/lib/subscribers/**/*.js", "node_modules/newrelic/lib/instrumentation/**/*.js"],
      sharp: ["--asset", "node_modules/@img"],
      sqljs: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
      typeorm_given: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
      pino: ["node_modules/thread-stream/lib/worker.js", "node_modules/pino/lib/worker.js", "node_modules/pino/file.js"],
    },
    [],
    ["argon2"],
    {
      ddtrace: "it traces Express by a hook on the loader, which does not see a `require()` of a constant path in an executable",
      otel: "it traces node:http and Express by a hook on the loader, which does not see a `require()` of a constant path in an executable",
    },
    form,
  );

export const testMorePrograms = () => testEachProgram("more-programs", 1, 1, {}, {}, [["node_modules/prisma/build/index.js", "generate", "--schema", "prisma/schema.prisma"]]);
