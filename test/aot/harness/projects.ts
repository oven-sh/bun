// Programs whose folders have a tsconfig.json each.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./run";

export type Files = Record<string, string>;

const foldersOf = (files: Files) =>
  Object.keys(files)
    .filter(path => path.endsWith("tsconfig.json") && !path.includes("node_modules/"))
    .map(path => path.slice(0, -"/tsconfig.json".length) || ".");

function listErrors(output: string, folder: string) {
  const errors = [...output.matchAll(/^(\S+?)\(\d+,\d+\): error (TS\d+)/gm)];
  return errors.map(([, path, code]) => `${join(folder, path).replaceAll("\\", "/")} ${code}`);
}

/** What `bun check` in the folder of each tsconfig.json says about the files that have no nearer one. */
async function checkEachProject(dir: string, files: Files) {
  const folders = foldersOf(files);
  const nearest = (file: string) =>
    folders
      .filter(folder => folder === "." || file.startsWith(folder + "/"))
      .reduce((nearest, folder) => (folder.length > nearest.length ? folder : nearest), ".");
  const found: string[] = [];
  for (const folder of folders) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty"], join(dir, folder));
    found.push(...listErrors(stdout, folder).filter(error => nearest(error) === folder));
  }
  return found.sort();
}

export async function build(dir: string) {
  const outfile = join(dir, "compiled" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile], dir);
  return { outfile, ...built };
}

export async function expectSameAnswerAsBunRun(files: Files) {
  using folder = tempDir("aot-projects", files);
  const dir = String(folder);
  const built = await build(dir);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringContaining("TS"),
    exitCode: 0,
  });
  const [compiled, plain] = [await run([built.outfile], dir), await run([bunExe(), "run", "./main.ts"], dir)];
  expect(plain.stdout).not.toBe("");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}

/** A build reports what `bun check` reports in the project of each file. One that reports nothing prints what `bun run` prints. */
export async function expectWhatEachProjectReports(files: Files) {
  using folder = tempDir("aot-projects", files);
  const dir = String(folder);
  const expected = await checkEachProject(dir, files);
  const checked = await run([bunExe(), "check", "--aot", "--no-pretty", "./main.ts"], dir);
  expect(listErrors(checked.stdout, ".").sort()).toEqual(expected);
  const built = await build(dir);
  expect(built.exitCode).toBe(expected.length ? 1 : 0);
  for (const error of expected) expect(built.stderr).toContain(error.split(" ")[1]);
  if (expected.length) return expected;
  const [compiled, plain] = [await run([built.outfile], dir), await run([bunExe(), "run", "./main.ts"], dir)];
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  return expected;
}
