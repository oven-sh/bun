import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  "asks-the-host.cjs": `"use strict";
    const Thing = require("./thing.cjs");
    const path = require.resolve("./keys.cjs");
    const registered = require.cache[path];
    console.log(typeof registered, registered.filename === path, registered.loaded, Object.keys(registered.exports).join(), registered.exports.kState === Object.getOwnPropertySymbols(new Thing(1))[0]);
    console.log(module.children.map(child => child.filename.slice(child.filename.lastIndexOf("/") + 1)).join(), require.cache[require.resolve("./thing.cjs")].children.length);\n`,
};

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function operationsOf(map: string, name: string) {
  const lines = map.split("\n");
  const found: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split("\t");
    if (fields[0] !== "F" || fields[7] !== name) continue;
    const operations = lines.slice(i + 1, i + 4).find(line => line.startsWith("O\t"));
    if (operations) found.push(operations.split("\t").filter(field => /^[A-Z][A-Za-z]+$/.test(field)));
  }
  return found;
}

test(
  "bun run --aot: the symbols that a CommonJS module that only makes values exports are names, and the host still finds the module",
  async () => {
    using dir = tempDir("aot-symbols-of-a-leaf-module-in-place", files);
    const mapPath = join(String(dir), "main.map");
    const plain = await run(String(dir), ["run", "./main.cjs"]);
    const compiled = await run(String(dir), ["run", "--debug-aot", "./main.cjs"], { BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_aotMapFilePath: mapPath });
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    const asked = await run(String(dir), ["run", "--debug-aot", "./asks-the-host.cjs"], { BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: asked.stdout, exitCode: asked.exitCode }).toEqual({ stdout: (await run(String(dir), ["run", "./asks-the-host.cjs"])).stdout, exitCode: 0 });
    const map = readFileSync(mapPath, "utf8");
    for (const name of ["Thing", "bump"]) {
      const bodies = operationsOf(map, name);
      expect({ name, bodies: bodies.length > 0 }).toEqual({ name, bodies: true });
      expect({ name, byKey: bodies.flat().filter(operation => operation === "GetByVal" || operation === "PutByVal") }).toEqual({ name, byKey: [] });
    }
  },
  120_000,
);
