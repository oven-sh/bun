// A program reads many names on an object that came out of parsed data and uses a standard stream, which brings in classes
// of built-in modules. What one more name adds to the work of the flow analysis does not depend on how many of those classes
// the program reaches: a read by name looks only at the objects of the library that hold something under that name.
//
// With BUN_JSC_logAOTPhaseTimes=1 the analysis prints, for each of its rounds, how many rules it ran and how many nodes and
// edges it made. They are counts: no clock. The program is built at two sizes on one thread, and the difference is divided
// by the number of names.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [200, 400];
const namesOfOneFunction = 50;
const most = { "statement runs": 18, nodes: 12, edges: 26 };

function sourceWith(names: number) {
  const functions = Math.ceil(names / namesOfOneFunction);
  let source = `const given = JSON.parse(process.argv[2] ?? "{}");\n`;
  for (let index = 0; index < functions; index++) {
    source += `function count${index}(object) {\n  let found = 0;\n`;
    for (let name = index * namesOfOneFunction; name < Math.min(names, (index + 1) * namesOfOneFunction); name++)
      source += `  if (object.n${name} !== undefined) found++;\n`;
    source += `  return found;\n}\n`;
  }
  source += `let sum = 0;\n`;
  for (let index = 0; index < functions; index++) source += `sum += count${index}(given);\n`;
  return source + `process.stdout.write(sum + "\\n");\n`;
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

test("one more name adds a few rules, nodes and edges", async () => {
  using dir = tempDir(
    "aot-names-on-an-object-nobody-follows",
    Object.fromEntries(sizes.map(size => [`names${size}.js`, sourceWith(size)])),
  );
  const directory = String(dir);
  // Side by side: each build has one thread.
  const counts = await Promise.all(
    sizes.map(async size => {
      const executable = join(directory, `names${size}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `names${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable, `{"n1":1,"n${size - 1}":2,"other":3}`], directory, bunEnv)).stdout).toBe("2\n");
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
