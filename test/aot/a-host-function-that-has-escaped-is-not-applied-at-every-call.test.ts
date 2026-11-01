// What lets in unseen code stays listed beside a value nobody knows. Once Bun.build has escaped, every callee nobody
// knows lists it, and a call that applied it read its hundred options off its own operands: calls times options.
// It is applied once for the whole program. The program below logs two thirds of the bound, and twice the bound if every call applies it.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { describe, test } from "./harness/declare";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const calls = 1500;

const lines = [
  `const hidden = (text: string) => JSON.parse(JSON.stringify(text));`,
  `const anything: any = JSON.parse('{ "list": [3, 4] }');`,
  `let setups = 0;`,
  `const state = { loads: 0, kind: "none" };`,
  `(globalThis as any)[hidden("kept")] = Bun.build;`,
  `const build = (globalThis as any)[hidden("kept")];`,
  `const result = await build({`,
  `  entrypoints: [process.cwd() + "/entry.js"],`,
  `  plugins: [{ name: "counts", setup(builder: any) {`,
  `    setups++;`,
  `    state.kind = typeof builder.onLoad;`,
  `    builder.onLoad({ filter: /entry\\.js$/ }, () => { state.loads++; return { contents: "export default 41 + 1;", loader: "js" }; });`,
  `  } }],`,
  `});`,
  `console.log(result.success, result.outputs.length, setups, JSON.stringify(state));`,
  `let sum = 0;`,
];
for (let index = 0; index < calls; index++)
  lines.push(`sum += anything.list.at(${index % 2}) + anything.list.indexOf(${index % 5}, { from: ${index} });`);
lines.push(`console.log(sum);`);

describe.skipIf(!!unsupported)("a host function that has escaped", () => {
  const { folder, build } = sharedBuilds("a-host-function-that-has-escaped-is-not-applied-at-every-call", {
    "main.ts": lines.join("\n") + "\n",
    "entry.js": "export default 0;\n",
  });

  test("is applied once: few edges, and its callbacks run as in plain Bun", async () => {
    const report = join(folder, "report.json");
    const built = await build("main.ts", "--aot", ...withReport(report, "summary"));
    expect(readBuildReport(report).statistics.FlowEdgesLogged).toBeLessThan(700000);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.ts"]));
  });
});
