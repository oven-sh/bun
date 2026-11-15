// A small program leaves most of what hangs below `process`, `Bun` and the global object out of its executable. Text that is decoded at run time reads every own name of each.
// Each read answers as `bun <file>` does, or is refused aloud by an error that names what was left out. It never answers anything else: a stand-in said "function" for an object once.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./with-compiler";

const program = `const ask = text => (0, eval)(Buffer.from(text).toString());
for (const holder of ["process", "Bun", "globalThis"]) {
  for (const name of ask("Object.getOwnPropertyNames(" + holder + ")").sort()) {
    let answer;
    try {
      answer = ask("typeof " + holder + "[" + JSON.stringify(name) + "]");
    } catch (error) {
      answer = String(error.message).includes(" was not compiled into this executable") ? "refused" : "threw " + error.constructor.name;
    }
    console.log(holder + "." + name + " " + answer);
  }
}
`;

async function linesOf(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return new Map(
    stdout
      .split("\n")
      .filter(Boolean)
      .map(line => line.split(" ", 2) as [string, string]),
  );
}

test("each read answers as plain does or is refused by name", async () => {
  using dir = tempDir("aot-every-own-name", { "walk.cjs": program });
  const directory = String(dir);
  const executable = join(directory, isWindows ? "walk.exe" : "walk");
  await linesOf([bunExe(), "build", "--compile", "--aot", "walk.cjs", "--outfile", executable], directory);
  const plain = await linesOf([bunExe(), "walk.cjs"], directory);
  const compiled = await linesOf([executable], directory);
  const names = [...plain.keys()].filter(name => compiled.has(name));
  expect(names.length).toBeGreaterThan(150);
  const refused = names.filter(name => compiled.get(name) === "refused");
  expect(refused.length).toBeGreaterThan(2);
  const answeredOtherwise = names.filter(
    name => compiled.get(name) !== "refused" && compiled.get(name) !== plain.get(name),
  );
  expect(answeredOtherwise.map(name => `${name}: ${plain.get(name)} | ${compiled.get(name)}`)).toEqual([]);
});
