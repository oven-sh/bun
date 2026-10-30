// A program uses a standard stream, which brings in built-in modules that keep state under names no program can write, and
// hands objects to an object that came out of parsed data. Each object holds the function that hands over the next one, so
// the flow analysis learns of them one after the other. What one more of them adds to its work does not depend on how often
// those modules read such a name: a read looks only at the objects that hold something under the name.
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
const most = { "statement runs": 20, nodes: 75, edges: 170 };

function sourceWith(objects: number) {
  let source = `const given = JSON.parse(process.argv[2] ?? "{}");\n`;
  for (let index = 0; index < objects; index++)
    source += `function step${index}() { given.k${index} = { f${index}: ${index}, next: step${index + 1} }; }\n`;
  return source + `function step${objects}() {}\nstep0();\nprocess.stdout.write(Object.keys(given).join() + "\\n");\n`;
}

function countsOf(log: string) {
  const counts = { "statement runs": 0, nodes: 0, edges: 0 };
  for (const line of log.split("\n")) {
    if (!line.startsWith("AOT flow round ")) continue;
    for (const column of line.split(" | "))
      for (const name of Object.keys(counts) as (keyof typeof counts)[])
        if (column.startsWith(name + " ")) counts[name] += Number(column.slice(name.length + 1));
  }
  return counts;
}

test("one more object adds a few rules, nodes and edges", async () => {
  using dir = tempDir(
    "aot-objects-that-leave-late",
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
      expect((await run([executable, `{"other":3}`], directory, bunEnv)).stdout).toBe("other,k0\n");
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
