// One module body makes thousands of object literals, as generated tables and bundled data do. For each literal the flow
// analysis wants the keys that are defined or stored right behind its allocation, and it finds them by reading through the
// function that holds it. It deals the objects of a program out in stretches, and each stretch read the whole function
// anew: as many readings as the function's objects fill stretches.
//
// With BUN_JSC_logAOTPhaseTimes=1 the analysis prints how many values it has read for those keys. It is a count: no clock.
// The program is built at two sizes on one thread: twice the literals are twice the values.
//
// A table of constant rows, or a JSON module, is one operation with an object for each row. Each stretch walked the whole
// table, and the writes of that one statement, dealt out in runs, were read to their end from the start of every run.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [12_000, 24_000];

function sourceWith(literals: number) {
  let source = "const all = [];\n";
  for (let index = 0; index < literals; index++) source += `all.push({ a: ${index}, b: all.length });\n`;
  return source + "let sum = 0;\nfor (const each of all) sum += each.a - each.b;\nconsole.log(sum, all.length);\n";
}

function tableWith(rows: number) {
  let source = "const table = [\n";
  for (let index = 0; index < rows; index++)
    source += `  { id: ${index}, name: "n${index}", tags: ["a", "b${index % 5}"] },\n`;
  // The rows of every stretch are read: what is known of a row decides the code of the loop.
  return (
    source +
    "];\nlet sum = 0;\nfor (const row of table) sum += row.id + row.name.length + row.tags[1].length;\nconsole.log(table.length, sum);\n"
  );
}
const sumOfTable = (rows: number) =>
  Array.from({ length: rows }, (_, index) => index + `n${index}`.length + 2).reduce((sum, row) => sum + row, 0);

// A build that finds out that the program needs more of Bun's own code compiles again: the count is that of the last run of the analysis.
function lastCount(log: string, what: string) {
  const lines = log.split("\n").filter(line => line.startsWith(`AOT flow tables | ${what} `));
  return Number(lines.at(-1)?.split(" ").at(-1));
}
const valuesReadIn = (log: string) => lastCount(log, "values read for the keys of allocations");

test("twice the literals are twice the values read for their keys", async () => {
  using dir = tempDir(
    "aot-literals-in-one-body",
    Object.fromEntries(sizes.map(size => [`literals${size}.js`, sourceWith(size)])),
  );
  const directory = String(dir);
  // Side by side: each build has one thread.
  const read = await Promise.all(
    sizes.map(async size => {
      const executable = join(directory, `literals${size}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `literals${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`0 ${size}\n`);
      return valuesReadIn(built.stderr + built.stdout);
    }),
  );
  expect(read[0]).toBeGreaterThan(sizes[0]);
  const grown = read[1] / read[0];
  expect(`grows ${grown <= 2.5 ? "with the literals" : grown.toFixed(2) + " times"}`).toBe("grows with the literals");
}, 240_000);

test("twice the rows of a table are twice the nodes and writes read", async () => {
  const rows = [20_000, 40_000];
  using dir = tempDir(
    "aot-rows-of-one-table",
    Object.fromEntries(rows.map(size => [`table${size}.js`, tableWith(size)])),
  );
  const directory = String(dir);
  const read = await Promise.all(
    rows.map(async size => {
      const executable = join(directory, `table${size}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `table${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`${size} ${sumOfTable(size)}\n`);
      const log = built.stderr + built.stdout;
      return {
        nodes: lastCount(log, "nodes of data literals read"),
        writes: lastCount(log, "writes read for the starts of runs"),
      };
    }),
  );
  for (const what of ["nodes", "writes"] as const) {
    expect(read[0][what]).toBeGreaterThan(rows[0]);
    const grown = read[1][what] / read[0][what];
    expect(`${what}: ${grown <= 2.5 ? "grow with the rows" : "grow " + grown.toFixed(2) + " times"}`).toBe(
      `${what}: grow with the rows`,
    );
  }
}, 240_000);
