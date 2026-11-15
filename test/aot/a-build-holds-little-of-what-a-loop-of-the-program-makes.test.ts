// Runs alone: it judges by the memory that a build holds and by its processor seconds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes. What that run makes is counted, and
// what makes it pays: a written list, a written object and the list of a rest parameter by the number of their places.
async function build(folder: string, name: string, text: string) {
  writeFileSync(join(folder, name + ".cjs"), text);
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${name}.cjs`,
      "--outfile",
      join(folder, name + (isWindows ? ".exe" : "")),
    ],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  const usage = built.resourceUsage()!;
  return { bytes: usage.maxRSS, seconds: Number(usage.cpuTime.user) / 1e6 };
}

const room = 256 * 1024 * 1024;
const places = (count: number, place: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => place(index)).join(", ");
const program = (made: string, helper: string, turns: number) => `"use strict";
${helper}
function gather(v, turns) { const kept = []; for (let i = 0; i < turns; i++) kept[i] = ${made}; return kept; }
const kept = gather(1.5, ${turns});
function word() { return "a" + (kept.length % 7); }
console.log(kept.length, new RegExp(word()).source);
`;

const makers = {
  "written lists of 256 places": { made: `[${places(256, () => "v")}]`, helper: "" },
  "written objects of 256 fields": { made: `{ ${places(256, index => `k${index}: v`)} }`, helper: "" },
  "lists of a rest parameter of 256 places": {
    made: `keep(${places(256, () => "v")})`,
    helper: "function keep(...all) { return all; }",
  },
};

for (const [what, { made, helper }] of Object.entries(makers)) {
  test(`a build holds little of 600000 ${what} that the program keeps`, async () => {
    using dir = tempDir("aot-what-a-loop-makes", {});
    const folder = String(dir);
    const one = await build(folder, "one", program(made, helper, 1));
    const many = await build(folder, "many", program(made, helper, 600000));
    reads(
      `what a build holds of 600000 ${what}`,
      (many.bytes - one.bytes) / room,
      3,
      "times the room of a build's first run",
    );
    if (!isASAN && !isDebug) expect((many.bytes - one.bytes) / room).toBeLessThan(3);
  }, 240_000);
}

test("a build takes no longer for four times the turns of a loop that makes long lists and drops them", async () => {
  using dir = tempDir("aot-what-a-loop-drops", {});
  const folder = String(dir);
  const dropped = (turns: number) => `"use strict";
function churn(v, turns) { let last = null; for (let i = 0; i < turns; i++) last = [${places(1024, () => "v")}]; return last; }
const last = churn(1.5, ${turns});
function word() { return "a" + (last.length % 7); }
console.log(last.length, new RegExp(word()).source);
`;
  const few = await build(folder, "few", dropped(100000));
  const many = await build(folder, "many", dropped(400000));
  reads("four times the turns", many.seconds / few.seconds, 2, "times the processor seconds");
  expect(many.seconds / few.seconds).toBeLessThan(2);
}, 240_000);
