import { afterAll, expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { moreBuildFlags, slot } from "../harness/commands";
import { run } from "../harness/run";
import { beforeAll, test } from "../supported";

/** Each program of apps/<group> uses public packages as their documentation does, and prints the same from an executable as under `bun run`. */
export function testPrograms(group: string) {
  const source = join(import.meta.dir, "apps", group);
  let dir: ReturnType<typeof tempDir> | undefined;
  let project = "";

  beforeAll(async () => {
    dir = tempDir(`aot-programs-${group}`, {});
    project = join(String(dir), "project");
    cpSync(source, project, { recursive: true });
    const installed = process.env.BUN_TEST_AOT_FRAMEWORK_PACKAGES;
    const { stdout, stderr, exitCode } = installed
      ? await run(["cp", "-R", join(installed, group, "node_modules"), "node_modules"], project)
      : await run([bunExe(), "install", "--frozen-lockfile", "--ignore-scripts", "--linker", "hoisted"], project);
    expect({ output: exitCode === 0 ? "" : stdout + stderr, exitCode }).toEqual({ output: "", exitCode: 0 });
    mkdirSync(join(project, "node_modules", "@types"), { recursive: true });
    symlinkSync(
      join(import.meta.dir, "..", "..", "..", "packages", "bun-types"),
      join(project, "node_modules", "@types", "bun"),
    );
  }, 600_000);
  afterAll(() => dir?.[Symbol.dispose]());

  for (const file of readdirSync(source).filter(name => /\.tsx?$/.test(name)))
    test.concurrent(
      file.replace(/\.tsx?$/, ""),
      () =>
        slot(async () => {
          const expected = await run([bunExe(), file], project);
          expect(expected.exitCode).toBe(0);
          expect(expected.stdout).not.toBe("");

          const executable = join(String(dir), file.replace(/\.tsx?$/, ""));
          const built = await run(
            [bunExe(), "build", "--compile", "--aot", ...moreBuildFlags, file, "--outfile", executable],
            project,
          );
          expect({ output: built.exitCode === 0 ? "" : built.stdout + built.stderr, exitCode: built.exitCode }).toEqual(
            {
              output: "",
              exitCode: 0,
            },
          );

          expect(await run([executable], String(dir))).toEqual(expected);
        }),
      600_000,
    );
}
