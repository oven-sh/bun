import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A server makes each request and each response of a small object of options and looks on it for names that it does not hold. A test may lay such a name on
// Object.prototype. The compiled text has a short road that makes no such objects: it is taken only while nothing was added to Object.prototype.
async function take(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--timeout=60000", ...flags, "./options.test.js"],
    directory,
    bunEnv,
  );
  if (exitCode !== 0) console.error(stderr);
  expect(exitCode).toBe(0);
  const lines = stdout.split("\n").filter(line => line.includes(": "));
  return {
    answers: lines.filter(line => !line.startsWith("road: ")),
    roads: lines.filter(line => line.startsWith("road: ")).map(line => line.slice(line.lastIndexOf(" ") + 1)),
  };
}

test("an option that a test lays on Object.prototype is honored by a server compiled as plain", async () => {
  using dir = tempDir("an-option-laid-on-object-prototype", {
    "options.test.js": await Bun.file(
      join(import.meta.dir, "an-option-laid-on-object-prototype", "options.fixture.js"),
    ).text(),
  });
  const plain = await take(String(dir));
  const compiled = await take(String(dir), "--aot");
  expect(plain.answers.length).toBe(29);
  expect(compiled.answers).toEqual(plain.answers);
  // The case holds nothing unless the short road was there to be left.
  expect(compiled.roads.slice(0, 2)).toEqual(["short", "short"]);
  expect(new Set(compiled.roads.slice(2))).toEqual(new Set(["full"]));
  expect(new Set(plain.roads)).toEqual(new Set(["full"]));
});
