import { expect } from "bun:test";
import { beforeAll, describe, test } from "../supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

function testEachProgram(folder: string, part: number, parts: number, needsTheDisk: Record<string, string>, given: Record<string, string[]> = {}, prepare: string[][] = []) {
  const programs = readdirSync(join(import.meta.dir, folder))
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.startsWith("fake_") && !file.startsWith("lib_"))
    .map(file => file.slice(0, -".ts".length))
    .sort()
    .filter((_, index) => index % parts === part);

  const dir = tempDir(`aot-backend-${folder}`, {});
  const project = join(String(dir), "project");

  async function run(cmd: string[], env: Record<string, string | undefined> = bunEnv) {
    await using ran = Bun.spawn({ cmd, cwd: project, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
    return { stdout, stderr, exitCode };
  }

  const steady = (text: string) =>
    text
      .split("\n")
      .filter(line => !line.startsWith("TIME "))
      .join("\n")
      .replaceAll(project, "<project>")
      .replace(/took [0-9.]+m?s/g, "took N ms");

  describe(folder, () => {
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
      test(
        program,
        async () => {
          const plain = await run([bunExe(), "run", `./${program}.ts`]);
          expect(plain.stdout).toContain("\nDONE");
          const executable = join(String(dir), program);
          const built = await run([bunExe(), "build", "--compile", "--aot", "--compile-in-place", `./${program}.ts`, ...(given[program] ?? []), "--outfile", executable]);
          expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({ output: "", exitCode: 0 });
          const compiled = await run([executable]);
          expect({ stdout: steady(compiled.stdout), exitCode: compiled.exitCode }).toEqual({ stdout: steady(plain.stdout), exitCode: plain.exitCode });
          if (program in needsTheDisk) return;

          const movedAway = join(String(dir), "moved-away");
          renameSync(project, movedAway);
          mkdirSync(project);
          try {
            const alone = await run([executable]);
            expect({ stdout: steady(alone.stdout), exitCode: alone.exitCode }).toEqual({ stdout: steady(plain.stdout), exitCode: plain.exitCode });
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

export const testPrograms = (part: number, parts: number) =>
  testEachProgram(
    "programs",
    part,
    parts,
    {
      sequelize: "a driver that is required by a computed name",
      typeorm: "a driver that is required by a computed name",
    },
    {
      argon2: ["--asset", "node_modules/argon2/prebuilds"],
      bcrypt: ["--asset", "node_modules/bcrypt/prebuilds"],
      newrelic: ["node_modules/newrelic/lib/subscribers/**/*.js", "node_modules/newrelic/lib/instrumentation/**/*.js"],
      sharp: ["--asset", "node_modules/@img"],
      sqljs: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
      typeorm_given: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
      pino: ["node_modules/thread-stream/lib/worker.js", "node_modules/pino/lib/worker.js", "node_modules/pino/file.js"],
    },
  );

export const testMorePrograms = () => testEachProgram("more-programs", 0, 1, {}, {}, [["node_modules/prisma/build/index.js", "generate", "--schema", "prisma/schema.prisma"]]);
