// An untyped program hands object literals from all over to its functions through one caller, as a renderer hands
// properties to components. Each function copies what it is handed into an object of its own, `{ ...given, own: 1 }`, stores
// into the copy and reads it by name. Each function hands a literal to the next one, so the flow analysis learns of them one
// after the other: what a function may be handed is every literal known so far.
//
// The copy of a record is a record with the same layout, so what is stored into the copy counts as stored into each record
// that it may be a copy of. The analysis says so once it knows the literals, not anew for each literal it learns of: what
// one more function adds to its nodes does not depend on how many came before it.
//
// With BUN_JSC_logAOTPhaseTimes=1 the analysis prints, for each of its rounds, how many nodes and edges it made. They are
// counts: no clock. The program is built at two sizes on one thread, and the difference is divided by the number of functions.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [150, 300];
const most = { nodes: 260, edges: 2400 };

function sourceWith(functions: number) {
  let source = `function hand(next, given) { return { next, given }; }\nlet count = 0;\nlet total = 0;\n`;
  source += `function runAll(handed) { while (handed) handed = handed.next(handed.given); }\n`;
  for (let index = 0; index < functions; index++) {
    source += `function step${index}(given) { const own = { ...given, k${index}: ${index} }; total += (own.a${index} | 0) + (own.common | 0); `;
    source += `if (own.k${index} === ${index}) count++; return hand(step${index + 1}, { a${index + 1}: count, b${index + 1}: ${index}, common: 1 }); }\n`;
  }
  source += `function step${functions}(given) { total += given.common | 0; return null; }\n`;
  return source + `runAll(hand(step0, { a0: 1, b0: 2, common: 1 }));\nconsole.log(count, total > count);\n`;
}

function countsOf(log: string) {
  const counts = { nodes: 0, edges: 0 };
  for (const line of log.split("\n")) {
    if (!line.startsWith("AOT flow round ")) continue;
    for (const column of line.split(" | "))
      for (const name of Object.keys(counts) as (keyof typeof counts)[])
        if (column.startsWith(name + " ")) counts[name] += Number(column.slice(name.length + 1));
  }
  return counts;
}

test("one more function that copies what it is handed adds a bounded number of nodes and edges", async () => {
  using dir = tempDir(
    "aot-objects-copied-from-whatever-is-handed-on",
    Object.fromEntries(sizes.map(size => [`functions${size}.js`, sourceWith(size)])),
  );
  const directory = String(dir);
  // Side by side: each build has one thread.
  const counts = await Promise.all(
    sizes.map(async size => {
      const executable = join(directory, `functions${size}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", withThreads(1), `functions${size}.js`, "--outfile", executable],
        directory,
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`${size} true\n`);
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
