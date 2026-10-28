import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "keys.cjs": `"use strict";\nconst keys = { kState: Symbol("state"), kCount: Symbol("count") };\nmodule.exports = keys;\n`,
  "thing.cjs": `"use strict";
    const { kState, kCount } = require("./keys.cjs");
    function Thing(value) { this[kState] = value; this[kCount] = 0; }
    Thing.prototype.bump = function bump() { this[kCount] = this[kCount] + 1; return this[kState]; };
    module.exports = Thing;\n`,
  "main.cjs": `"use strict";
    const Thing = require("./thing.cjs");
    let total = 0;
    for (let i = 0; i < 300; i++) { const thing = new Thing(i); total += thing.bump() + thing.bump(); }
    console.log(total, Object.getOwnPropertySymbols(new Thing(1)).map(String).join());\n`,
};

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}

function operationsByFunction(map: string) {
  const lines = map.split("\n");
  const found: { name: string; operations: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split("\t");
    if (fields[0] !== "F") continue;
    const operations = lines.slice(i + 1, i + 4).find(line => line.startsWith("O\t"));
    if (operations)
      found.push({
        name: fields[7],
        operations: operations.split("\t").filter(field => /^[A-Z][A-Za-z]+$/.test(field)),
      });
  }
  return found;
}

test("bun run --aot: the symbols that a CommonJS module that only makes values exports are names", async () => {
  using dir = tempDir("aot-symbols-of-a-leaf-module-in-place", files);
  const mapPath = join(String(dir), "main.map");
  const plain = await run(String(dir), ["run", "./main.cjs"]);
  const compiled = await run(String(dir), ["run", "--debug-aot", "./main.cjs"], {
    BUN_JSC_crashIfInterpreterIsUsed: "1",
    BUN_JSC_aotMapFilePath: mapPath,
  });
  expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  const bodies = operationsByFunction(readFileSync(mapPath, "utf8")).filter(
    body => body.name === "" || body.name.startsWith("Thing"),
  );
  expect(bodies.map(body => body.name)).toContain("Thing");
  expect(
    bodies
      .filter(body => body.operations.includes("ElemGet") || body.operations.includes("ElemSet"))
      .map(body => body.name),
  ).toEqual([]);
}, 120_000);
