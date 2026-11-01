// `function re(a, b) { return new RegExp(a + b) }`: the build works each caller's text out, by a walk that may follow so many values and no more, so that it cannot run away. First it takes what
// all callers pass together, which follows a value for each caller at the least: with more callers than that budget (16,384) it came to its end among them, gave the call up, and every one of
// the patterns was interpreted: with 16,300 callers all had their code, with 16,400 none. A budget is no bound on how large a program may be: each caller gets a walk of its own.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

const callers = 20_000;
const inOneFunction = 100;
const parts = Array.from({ length: callers / inOneFunction }, (_, part) => {
  const calls = Array.from(
    { length: inOneFunction },
    (_, at) => `re("^item${part * inOneFunction + at}[a-z]+", "(?:x|y)\\\\d{2}$")`,
  );
  return `function part${part}() { return [${calls.join(", ")}]; }`;
});
const program = `function re(a, b) { return new RegExp(a + b); }
${parts.join("\n")}
const made = [${parts.map((_, part) => `part${part}`).join(", ")}].flatMap(part => part());
let hits = 0;
for (let i = 0; i < made.length; i++) hits += made[i].test("item" + i + "abcx42") ? 1 : 0;
console.log(made.length, hits);
`;

test(
  `each of ${callers} callers' patterns has its code`,
  () =>
    slot(async () => {
      using dir = tempDir("aot-more-callers-than-a-walk-follows-values", { "main.js": program });
      const folder = String(dir);
      const build = await spawned(
        [bunExe(), "build", "--compile", "--aot", "--aot-report=report.json", "main.js", "--outfile", "out"],
        folder,
        { ...bunEnv, NO_COLOR: "1" },
      );
      built(build);
      expect((build.stdout + build.stderr).split("\n").filter(line => line.includes("TS100058"))).toEqual([]);
      expect(JSON.parse(readFileSync(join(folder, "report.json"), "utf8")).statistics.RegExpCandidatesCompiled).toBe(
        callers,
      );
      const ran = await spawned([join(folder, isWindows ? "out.exe" : "out")], folder, bunEnv);
      expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
        stdout: `${callers} ${callers}\n`,
        stderr: "",
        exitCode: 0,
      });
    }),
  300_000,
);
