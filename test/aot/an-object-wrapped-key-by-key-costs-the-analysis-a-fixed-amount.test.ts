// A program passes each of its objects through one function that lists the object's own keys and puts a wrapper in the
// place of each function it finds, as a recorder of calls does. Each object holds the function that makes the next one, so
// the flow analysis learns of them one after the other, and each has a key of its own, so the list of keys holds as many
// names as there are objects. What one more object adds to the work of the analysis does not depend on how many came
// before it: past a bound, the names of one computed key count together.
//
// With BUN_JSC_logAOTPhaseTimes=1 the analysis prints, for each of its rounds, how many rules it ran and how many nodes and
// edges it made. They are counts: no clock. The program is built at two sizes on one thread, and the difference is divided
// by the number of objects.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [200, 400];
const most = { "statement runs": 60, nodes: 140, edges: 520 };

function sourceWith(objects: number) {
  let source = `const calls = [];\n`;
  source += `function record(target) {\n  for (const key of Object.keys(target)) {\n    const original = target[key];\n    if (typeof original !== "function") continue;\n`;
  source += `    target[key] = function (...operands) { calls.push(key); return original.apply(this, operands); };\n  }\n  return target;\n}\n`;
  for (let index = 0; index < objects; index++)
    source += `function step${index}() { const made = record({ f${index}: ${index}, next: step${index + 1} }); return made.next(); }\n`;
  return source + `function step${objects}() { return calls.length; }\nconsole.log(step0());\n`;
}

// A build that finds out that the program needs more of Bun's own code compiles again: the counts are those of the last run of the analysis.
function countsOf(log: string) {
  const counts = { "statement runs": 0, nodes: 0, edges: 0 };
  for (const line of log.split("\n")) {
    if (!line.startsWith("AOT flow round ")) continue;
    if (line.startsWith("AOT flow round 1 "))
      for (const name of Object.keys(counts)) counts[name as keyof typeof counts] = 0;
    for (const column of line.split(" | "))
      for (const name of Object.keys(counts) as (keyof typeof counts)[])
        if (column.startsWith(name + " ")) counts[name] += Number(column.slice(name.length + 1));
  }
  return counts;
}

test("one more object adds a few rules, nodes and edges", async () => {
  using dir = tempDir(
    "aot-objects-wrapped-key-by-key",
    Object.fromEntries(sizes.map(size => [`objects${size}.js`, sourceWith(size)])),
  );
  const directory = String(dir);
  // Side by side: each build has one thread.
  const counts = await Promise.all(
    sizes.map(async size => {
      const executable = join(directory, `objects${size}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `objects${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`${size}\n`);
      return countsOf(built.stderr + built.stdout);
    }),
  );
  expect(counts[0].edges).toBeGreaterThan(0);
  for (const name of Object.keys(most) as (keyof typeof most)[]) {
    const added = (counts[1][name] - counts[0][name]) / (sizes[1] - sizes[0]);
    expect(`${name}: ${added > 0 && added <= most[name] ? "within the bound" : added}`).toBe(
      `${name}: within the bound`,
    );
  }
}, 240_000);
