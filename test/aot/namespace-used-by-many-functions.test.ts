// `import * as other` used by every function of a module: each use ties the namespace object to all the exports of the
// other module, so one round of flow logged uses times exports edges, nearly all of them the same, and went past the edge
// budget long before the program did. No test program is that large, so the budget is lowered: the program logs 4,500,000
// edges that way, and needs far fewer than the budget.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const functions = 1500;
const moduleCalling = (other: string, base: number) => `import * as other from "./${other}.js";
${Array.from(
  { length: functions },
  (_, index) =>
    `export function f${index}(a, depth) { return depth <= 0 ? a + ${base + index} : other.f${index}(a, depth - 1) + 1; }`,
).join("\n")}
`;

describe.skipIf(!!unsupported)("a namespace used by many functions", () => {
  const { folder, build } = sharedBuilds("namespace-used-by-many-functions", {
    "a.js": moduleCalling("b", 0),
    "b.js": moduleCalling("a", 5000),
    "main.js": `import * as a from "./a.js";
import * as b from "./b.js";
let sum = 0;
for (let index = 0; index < ${functions}; index++) sum = (sum + a[\`f\${index}\`](index, index % 3) + b[\`f\${index}\`](index, index % 2)) | 0;
console.log(sum);
`,
  });

  test("keeps whole-program analysis and prints what plain Bun prints", async () => {
    const built = await build("main.js", "--aot", "--aot-limit=MaxValueFlowEdgesLogged:2000000");
    expect(built.stderr + built.stdout).not.toContain("TS100073");
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.js"]));
  });
});
