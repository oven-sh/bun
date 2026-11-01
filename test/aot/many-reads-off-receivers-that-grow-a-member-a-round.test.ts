// One value may be an instance of any of 300 classes, which reach it one a round, and 1,000 statements each read a
// property of their own off it.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./listed";

const classes = 300;
const reads = 1000;

const lines: string[] = [`const all = [];`];
for (let c = 0; c < classes; c++) lines.push(`class C${c} { constructor() { this.own${c} = ${c}; } }`);
for (let c = classes - 1; c >= 0; c--)
  lines.push(
    `const step${c} = { run() { all.push(new C${c}()); return ${c + 1 < classes ? `step${c + 1}` : `null`}; } };`,
  );
lines.push(
  `let step = step0;`,
  `while (step) step = step.run();`,
  `let sum = 0;`,
  `const pick = all[process.argv.length % all.length];`,
);
for (let r = 0; r < reads; r++) lines.push(`if (pick.name${r} !== undefined) sum += ${r};`);
lines.push(`if (pick.own2 !== undefined) sum += pick.own2;`, `console.log(all.length, sum);`);

describe.skipIf(!!unsupported)("many reads off receivers that grow a member a round", () => {
  const { folder, build } = sharedBuilds("many-reads-off-receivers-that-grow-a-member-a-round", {
    "main.js": lines.join("\n") + "\n",
  });

  test("leave few readers behind and print what plain Bun prints", async () => {
    const report = join(folder, "report.json");
    const built = await build("main.js", "--aot", ...withReport(report, "summary"));
    expect(readBuildReport(report).statistics.FlowReaders).toBeLessThan(150000);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.js"]));
  });
});
