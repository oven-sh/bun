// While flow solves, the bodies of all functions are parked, and a rule that reads one takes it back: memory at the
// top of the build. Everyday code must not make a rule do that: what rules ask of the text of an operation stands
// beside flow's own statements. A rule that newly opens the body of every function with a literal or a loop in it
// fails no other test and moves no answer.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./listed";

const functions = 400;
const everydayCode = (index: number) => `
class C${index} {
  #held = ${index};
  static made = 0;
  get held() { return this.#held; }
  set held(value) { this.#held = value; }
  plus(a) { C${index}.made++; return this.#held + a; }
}
export function f${index}(a) {
  const literal = { a, b: ${index}, c: "x${index}" };
  const data = { list: [1, 2, ${index}], nested: { k: "v${index}" } };
  let sum = 0;
  for (const item of data.list) sum += item;
  for (const name in literal) sum += String(literal[name]).length;
  const all = [...data.list, a];
  const copy = { ...literal, d: all.length };
  const bound = add.bind(null);
  const object = new C${index}();
  object.held = sum;
  return bound(object.plus(copy.d), copy.b) + data.nested.k.length;
}`;

describe.skipIf(!!unsupported)("flow leaves the bodies of functions parked", () => {
  const { folder, build } = sharedBuilds("flow-leaves-the-bodies-of-functions-parked", {
    "everyday.js": `function add(a, b) { return a + b; }\n${Array.from({ length: functions }, (_, index) => everydayCode(index)).join("\n")}\n`,
    "main.js": `import * as everyday from "./everyday.js";
let sum = 0;
for (let index = 0; index < ${functions}; index++) sum = (sum + everyday[\`f\${index}\`](index)) | 0;
console.log(sum);
`,
  });

  test("literals, loops, spreads, classes and bound functions open no body", async () => {
    const report = join(folder, "report.json");
    const built = await build("main.js", "--aot", ...withReport(report, "summary"));
    const { FlowBodiesParked, FlowBodiesTakenBack } = readBuildReport(report).statistics;
    expect(FlowBodiesParked).toBeGreaterThan(5 * functions);
    expect(FlowBodiesTakenBack / FlowBodiesParked).toBeLessThan(0.05);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.js"]));
  });
});
