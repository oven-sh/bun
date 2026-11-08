import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Where a file of a test run mentions Bun.plugin, a require() that writes its name out asks Bun's own require(), which makes a module object for the file at every call.
// The object was listed as a child of the object behind `import.meta.require` of the ES module that asked, so none of them was ever collected,
// and a CommonJS file that read `module.parent.children` found them there in place of its own `module`.
const files = (mention: string): Record<string, string> => ({
  "a.test.ts": `import { test } from "bun:test";
import { heapStats } from "bun:jsc";
import { ask, askModule, roads } from "./user";
import { askToo } from "./second";
test("what is kept", () => {
  ${mention}
  for (const [road, take] of Object.entries(roads)) {
    for (let i = 0; i < 200; i++) take();
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.Module ?? 0;
    let sum = 0;
    for (let i = 0; i < 5_000; i++) sum += take();
    Bun.gc(true);
    const kept = (heapStats().objectTypeCounts.Module ?? 0) - before;
    console.log("SEEN", road, sum, kept < 100 ? "keeps nothing" : "keeps module objects");
  }
});
test("whose child the file is", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", ask());
  say("again", ask());
  say("another file asks", askToo());
  say("a module", askModule(), ask());
  const copy = await import("./user.ts?again");
  say("a copy under a query asks", copy.ask(), ask());
});
`,
  "user.ts": `import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
const held = import.meta.require;
export const roads: Record<string, () => number> = {
  "an ES module": () => require("./lib.ts").value(),
  "a CommonJS file": () => require("./old.cjs").value(),
  "a JSON file": () => require("./data.json").value,
  "through createRequire()": () => made("./old.cjs").value(),
  "through import.meta.require": () => held("./lib.ts").value(),
};
export const ask = () => require("./seen.cjs").seen();
export const askModule = () => Object.keys(require("./other.ts"));
`,
  "second.ts": `export const askToo = () => require("./seen.cjs").seen();
`,
  "seen.cjs": `const { basename } = require("node:path");
exports.seen = () => {
  const { parent } = module;
  return [basename(parent.filename), parent.children.map(child => basename(child.filename)), parent.children.includes(module), module.children.length];
};
`,
  "lib.ts": `export const value = () => 1;
`,
  "other.ts": `export const other = 2;
`,
  "old.cjs": `exports.value = () => 1;
`,
  "data.json": `{ "value": 1 }
`,
  "package.json": `{ "name": "p", "type": "module" }
`,
});
const shapes = {
  "a file mentions Bun.plugin": `if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });`,
  "no file mentions it": ``,
};

for (const [name, mention] of Object.entries(shapes)) {
  test.concurrent(
    `a require() that goes through the host keeps no module object: ${name}`,
    async () => {
      using dir = tempDir("aot-require-keeps-no-module-object", files(mention));
      const seenWith = async (...flags: string[]) => {
        // How long 25,000 calls take is not asked here. Where a stack trace is kept at every exception scope the compiled run took 4 to 7 s, and a test has 5.
        const command = [bunExe(), "test", "--timeout=100000", ...flags];
        const { stdout, stderr, exitCode } = await run(command, String(dir), bunEnv);
        return {
          lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
          exitCode,
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.lines).toHaveLength(10);
      expect(plain.lines.filter(line => line.endsWith("5000 keeps nothing"))).toHaveLength(5);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );
}
