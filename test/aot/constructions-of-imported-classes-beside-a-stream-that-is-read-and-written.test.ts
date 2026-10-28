// `new Readable()` enters the constructor that the import names behind one test. What else the program constructs out of node:stream makes no difference to that.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { test } from "./supported";

const program = (names: string[]) => `import { ${names.join(", ")} } from "node:stream";
let sum = 0;
for (let i = 0; i < 3; i++) {
${names.map(name => `  sum += new ${name}().listenerCount("a");`).join("\n")}
}
console.log(sum);
`;

async function callsOf(names: string[]) {
  using dir = tempDir("aot-constructions-of-imports", { "main.mjs": program(names) });
  const { stdout } = await run([bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.mjs"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return parseExplainLines(stdout).numbers.calls;
}

test.each(["Writable", "Duplex", "Transform", "PassThrough"])(
  "both constructions are tested calls beside a construction of %s",
  async other => {
    expect((await callsOf(["Readable", other])).guarded).toBeGreaterThanOrEqual(2);
  },
  120_000,
);
