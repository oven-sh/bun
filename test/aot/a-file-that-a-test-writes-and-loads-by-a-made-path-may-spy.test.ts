import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The path of the file comes from the environment or holds the pid, so no build sees the file. Its text stands in the test.
const ways: Record<string, { imports?: string; text: string; call: string }> = {
  "it imports the module and spies on an export": {
    text: `import { spyOn } from "bun:test"; import * as lib from "../lib.js"; export const spy = () => spyOn(lib, "total");`,
    call: `loaded.spy()`,
  },
  "it is handed the namespace object and the name": {
    imports: `import * as lib from "./lib.js";`,
    text: `import { spyOn } from "bun:test"; export const spy = (object, name) => spyOn(object, name);`,
    call: `loaded.spy(lib, "total")`,
  },
  "it spies under the global jest": {
    text: `import * as lib from "../lib.js"; export const spy = () => jest.spyOn(lib, "total");`,
    call: `loaded.spy()`,
  },
  "it imports the module and spies under a name it is told": {
    text: `import { spyOn } from "bun:test"; import * as lib from "../lib.js"; export const spy = name => spyOn(lib, name);`,
    call: `loaded.spy("total")`,
  },
};

for (const [name, way] of Object.entries(ways)) {
  test(`a file that a test writes and loads by a made path: ${name}`, async () => {
    using dir = tempDir("aot-written-file-spies", {
      "package.json": `{ "name": "written-file-spies", "type": "module" }`,
      "lib.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function other(x) { return x * 2; }\n`,
      "reader.js": `import { total, other } from "./lib.js";\nexport const read = () => [total([1, 2, 3]), other(4)];\n`,
      "a.test.js": `
import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { read } from "./reader.js";
${way.imports ?? ""}
test("a spy", async () => {
  mkdirSync(import.meta.dir + "/made", { recursive: true });
  const path = import.meta.dir + "/made/spy" + process.pid + ".js";
  writeFileSync(path, ${JSON.stringify(way.text)});
  const before = read();
  const loaded = await import(process.env.WHERE ?? path);
  const made = ${way.call};
  made.mockImplementation(() => "spied");
  const under = read();
  made.mockRestore();
  console.error("SEEN " + JSON.stringify([before, under, read()]));
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")),
        startsOver: lines.filter(line => line.startsWith("AOT build starts over")),
        exitCode,
      };
    };
    const plain = await seenWith();
    expect(plain).toEqual({ seen: [`SEEN [[6,8],["spied",8],[6,8]]`], startsOver: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual(plain);
  });
}
