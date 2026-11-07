// A program stores `Function` under a computed key into a value that the flow analysis cannot follow. From then on whatever
// is read off such a value may be `Function`, and the analysis goes on listing it there, so that it sees where it is called.
// The program also copies object literals onto values it cannot follow, sets the prototype of one, and lets objects of its
// own out of sight. Each of its functions holds the next one, so the analysis learns of them one after the other.
//
// What is copied onto a value nobody follows is not kept at `Function`: what one more function adds to the work of the
// analysis does not depend on how many came before it.
//
// With BUN_JSC_logAOTPhaseTimes=1 the analysis prints, for each of its rounds, how many rules it ran and how many nodes and
// edges it made. They are counts: no clock. The program is built at two sizes on one thread, and the difference is divided
// by the number of functions.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const sizes = [100, 200];
const most = { "statement runs": 160, nodes: 280, edges: 800 };

function sourceWith(functions: number) {
  let source = `const given = globalThis[process.argv[2] ?? "nothing"] ?? { list: [], a: {}, b: {}, c: null };\nlet sum = 0;\n`;
  source += `given[process.argv[3] ?? "keep"] = Function;\nObject.setPrototypeOf(given.b, given.c);\n`;
  for (let index = 0; index < functions; index++) {
    source += `function step${index}() { Object.assign(given.a, { m${index}: ${index} }); const own = { x${index}: 1, next: step${index + 1} }; `;
    source += `given.list.push(own); sum += own.x${index} + (own.y${index} | 0); return own.next(); }\n`;
  }
  return (
    source +
    `function step${functions}() { return sum; }\nconsole.log(step0(), Object.keys(given.a).length, given.keep === Function);\n`
  );
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

test("one more function adds a few rules, nodes and edges", async () => {
  using dir = tempDir(
    "aot-function-constructor-under-a-computed-key",
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
      expect((await run([executable], directory, bunEnv)).stdout).toBe(`${size} ${size} true\n`);
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
