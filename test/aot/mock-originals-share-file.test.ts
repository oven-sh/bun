import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Two mocks whose factories take the original. Each original is its file once more, under a key of its own, and both import one file of the workspace,
// which plain Bun runs once, under its own key. Every file prints the key that it runs under.
const says = `console.log("RUNS", import.meta.url.replace(/.*packages./, ""));`;
const shared: Record<string, Record<string, string>> = {
  "the shared file has a body": {
    "packages/core/index.ts": `${says}
import { isUpKey, isEnterKey } from "./lib/key.ts";
import { create } from "./lib/create.ts";
export const keys = { isUpKey, isEnterKey };
export { create };`,
    "packages/confirm/index.ts": `${says} import { create, keys } from "core"; export default create("confirm", keys.isEnterKey);`,
    "packages/select/index.ts": `${says} import { create, keys } from "core"; export default create("select", keys.isUpKey);`,
  },
  "the shared file only hands names on": {
    "packages/core/index.ts": `${says}
export { isUpKey, isEnterKey } from "./lib/key.ts";
export { create } from "./lib/create.ts";`,
    "packages/confirm/index.ts": `${says} import { create, isEnterKey } from "core"; export default create("confirm", isEnterKey);`,
    "packages/select/index.ts": `${says} import { create, isUpKey } from "core"; export default create("select", isUpKey);`,
  },
};
const wraps = (name: string) => `vi.mock("${name}", async importOriginal => {
  try { const actual: any = await importOriginal(); return { ...actual, default: wrap(actual.default) }; }
  catch (error: any) { console.log("SAID swallowed ${name}:", error.constructor.name, error.message); return {}; }
});`;
const packages = ["core", "confirm", "select", "testing", "prompts"];

test.each(Object.keys(shared))(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    using dir = tempDir("aot-mock-originals-share-file", {
      "package.json": `{ "name": "p", "type": "module" }`,
      ...Object.fromEntries(
        packages.map(it => [
          `packages/${it}/package.json`,
          `{ "name": "${it}", "type": "module", "exports": "./index.ts" }`,
        ]),
      ),
      ...shared[name],
      "packages/core/lib/key.ts": `${says}
export const isUpKey = (key: string) => key === "up";
export const isEnterKey = (key: string) => key === "enter";`,
      "packages/core/lib/create.ts": `export const create = (name: string, test: (key: string) => boolean) => (key: string) => name + " " + test(key);`,
      "packages/prompts/index.ts": `${says}
export { default as confirm } from "confirm";
export { default as select } from "select";`,
      "packages/testing/index.ts": `import { vi } from "vitest";
const wrap = (prompt: any) => (key: string) => "wrapped " + prompt(key);
${wraps("confirm")}
${wraps("select")}`,
      "demo.ts": `import { confirm, select } from "prompts";
const ask = (prompt: any, key: string) => (typeof prompt === "function" ? prompt(key) : typeof prompt);
export default () => [ask(confirm, "enter"), ask(select, "up")].join(" | ");`,
      "demo.test.ts": `import { test } from "vitest";
import "testing";
import demo from "./demo.ts";
test("t", () => { console.log("SAID", demo()); });`,
    });
    mkdirSync(join(String(dir), "node_modules"));
    for (const it of packages)
      symlinkSync(join(String(dir), "packages", it), join(String(dir), "node_modules", it), "junction");
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => /^(RUNS|SAID)|was left out|rror:/.test(line)).sort();
    };
    const plain = await seen([], "");
    expect(plain).toContain("SAID wrapped confirm true | wrapped select true");
    expect(plain).toContain("RUNS core/index.ts");
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
