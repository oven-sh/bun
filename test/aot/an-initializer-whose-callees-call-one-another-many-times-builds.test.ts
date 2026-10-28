// The initializer of a variable calls a function that calls the next one twelve times, ten functions deep, and the last one reads a member that
// Object adds when it is first read. An initializer that is put off leaves such reads where it stood, each member once, however many ways lead to
// the read. The keys of a value that could be any object are listed, so the order of Object's keys counts. The program is only built: a run makes
// 12 ** 10 calls.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const depth = 10;
const width = 12;
const levels = Array.from(
  { length: depth },
  (_, level) =>
    `function level${level}() {\n  return [${Array(width)
      .fill(`level${level + 1}()`)
      .join(", ")}];\n}\n`,
);
const text = `${levels.join("")}function level${depth}() {
  return Object.create(null);
}
const made = level0();
export function take() {
  return made;
}
console.log(Reflect.ownKeys(globalThis[process.argv[2]]).length, take().length);
`;

test("compile/aot/an initializer whose callees call one another many times builds", async () => {
  using dir = tempDir("aot-initializer-many-ways", { "main.mjs": text });
  await using build = Bun.spawn({
    cmd: [bunExe(), ...compileCommand, "main.mjs", "--outfile", "main"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect({
    stderr: stderr.split("\n").filter(line => /^(error|panic)\b/.test(line)),
    exitCode,
    signal: build.signalCode,
  }).toEqual({ stderr: [], exitCode: 0, signal: null });
}, 300_000);
