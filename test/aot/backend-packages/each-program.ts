// Programs on packages from npm. A test file has a folder: its programs (<name>.ts), and the package.json and bun.lock of what they import.
// Each program prints what it gets from the packages and ends with DONE.
// An executable built with --aot prints what plain Bun prints, also where the project no longer lies.
// The programs of a file are built and run side by side. The project is moved away while nobody else needs it.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "../harness/run";
import { beforeAll, describe, test } from "../supported";

type Form = "in place" | "as one file";

export interface Program {
  /** "in place" unless given. */
  forms?: Form[];
  /** More arguments of the build: what the package loads under a computed name is a further entry point or an asset. */
  given?: string[];
  /** Why it finds something only where the project lies. */
  needsTheDisk?: string;
  /** Why the executable prints something else than plain Bun, on purpose. It still has to run to its end. */
  differs?: string;
  /** The package ships no build for these, as `${process.platform}-${process.arch}`. */
  shipsNoBuildFor?: string[];
  withoutExceptionValidation?: boolean;
}

/** Tests every program of ./<folder>. `programs` has what is to be said about some of them. */
export function testPrograms(folder: string, programs: Record<string, Program> = {}) {
  const names = readdirSync(join(import.meta.dir, folder))
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts") && !/^(fake|lib)_/.test(file))
    .map(file => file.slice(0, -".ts".length))
    .sort();

  const dir = tempDir(`aot-backend-${folder}`, {});
  const project = join(String(dir), "project");

  let usersOfProject = 0;
  let isProjectAway = false;
  const waiting: (() => void)[] = [];
  const untilSomethingChanges = () => new Promise<void>(resolve => waiting.push(resolve));
  const tellWhoWaits = () => waiting.splice(0).forEach(resolve => resolve());

  async function withProject<T>(work: () => Promise<T>): Promise<T> {
    while (isProjectAway) await untilSomethingChanges();
    usersOfProject++;
    try {
      return await work();
    } finally {
      usersOfProject--;
      tellWhoWaits();
    }
  }

  async function withoutProject<T>(work: () => Promise<T>): Promise<T> {
    while (isProjectAway || usersOfProject > 0) await untilSomethingChanges();
    isProjectAway = true;
    const movedAway = join(String(dir), "moved-away");
    renameSync(project, movedAway);
    mkdirSync(project);
    try {
      return await work();
    } finally {
      rmSync(project, { recursive: true, force: true });
      renameSync(movedAway, project);
      isProjectAway = false;
      tellWhoWaits();
    }
  }

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

  describe.concurrent(folder, () => {
    afterAll(() => rmSync(String(dir), { recursive: true, force: true }), 300_000);
    beforeAll(async () => {
      cpSync(join(import.meta.dir, folder), project, { recursive: true });
      const packages = join(project, "node_modules");
      const installed = process.env.BUN_TEST_AOT_BACKEND_PACKAGES;
      if (installed) {
        expect((await run(["cp", "-R", join(installed, folder, "node_modules"), packages])).exitCode).toBe(0);
      } else {
        const install = [bunExe(), "install", "--frozen-lockfile", "--ignore-scripts", "--linker", "hoisted"];
        const { stderr, exitCode } = await run(install);
        expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      }
      rmSync(join(packages, "@types", "bun"), { recursive: true, force: true });
      symlinkSync(join(import.meta.dir, "..", "..", "..", "packages", "bun-types"), join(packages, "@types", "bun"));
    }, 600_000);

    for (const name of names) {
      const program = programs[name] ?? {};
      for (const form of program.forms ?? ["in place"]) {
        test.skipIf(program.shipsNoBuildFor?.includes(`${process.platform}-${process.arch}`) === true)(
          `${name}, ${form}`,
          async () => {
            const env = program.withoutExceptionValidation
              ? { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined }
              : bunEnv;
            const executable = join(String(dir), `${name}-${form.replaceAll(" ", "-")}`);
            const [plain, built] = await withProject(() =>
              Promise.all([
                run([bunExe(), "run", `./${name}.ts`], env),
                run([
                  bunExe(),
                  "build",
                  "--compile",
                  "--aot",
                  ...(form === "in place" ? ["--compile-in-place"] : []),
                  `./${name}.ts`,
                  ...(program.given ?? []),
                  "--outfile",
                  executable,
                ]),
              ]),
            );
            expect(plain.stdout).toContain("\nDONE");
            const expected = { stdout: steady(plain.stdout), exitCode: plain.exitCode, stderr: "" };
            const told = (ran: typeof plain) => ({
              stdout: steady(ran.stdout),
              exitCode: ran.exitCode,
              stderr: ran.exitCode === plain.exitCode ? "" : ran.stderr,
            });

            expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
              output: "",
              exitCode: 0,
            });
            const compiled = await withProject(() => run([executable], env));
            if (program.differs)
              return void expect({
                isDone: compiled.stdout.includes("\nDONE"),
                exitCode: compiled.exitCode,
                stderr: compiled.exitCode ? compiled.stderr : "",
              }).toEqual({ isDone: true, exitCode: 0, stderr: "" });
            expect(told(compiled)).toEqual(expected);
            if (program.needsTheDisk) return;

            expect(told(await withoutProject(() => run([executable], env)))).toEqual(expected);
          },
          600_000,
        );
      }
    }
  });
}
