// `const { test } = require("bun:test")` takes one name, as `import { test } from "bun:test"` does. A compiled test run read it as the whole object of bun:test
// going out of sight, `mock` and `spyOn` with it: every module of the run counted as mocked and every object as spied on. Flow then knew so little that a package
// which patches `fetch` through a helper was refused: "Cannot assign to fetch because built-in objects are read-only in compiled code". nock 15 loads that way.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

const body = `("a package patches fetch through a helper", () => {
  const { activate } = require("patches");
  const real = fetch;
  const undo = activate();
  console.log("SEEN", typeof fetch, fetch === real);
  undo();
  console.log("SEEN", fetch === real);
});`;

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "type": "module", "main": "index.mjs" }`,
  "node_modules/patches/registry.mjs": `
    class Registry {
      applyPatch(owner, key, next) {
        const before = Object.getOwnPropertyDescriptor(owner, key);
        Object.defineProperty(owner, key, { value: next(owner[key]), enumerable: true, configurable: true });
        return () => Object.defineProperty(owner, key, before);
      }
    }
    export const registry = new Registry();`,
  "node_modules/patches/index.mjs": `
    import { registry } from "./registry.mjs";
    export function activate() {
      return registry.applyPatch(globalThis, "fetch", real => (...all) => real(...all));
    }`,
  "names.test.cjs": `const { test } = require("bun:test");\ntest${body}`,
  "member.test.cjs": `require("bun:test").test${body}`,
  "several.test.cjs": `const { test, expect, describe } = require("bun:test");\ndescribe("d", () => { test${body} });`,
  "meta.test.mjs": `const { test } = import.meta.require("bun:test");\nconst require = import.meta.require;\ntest${body}`,
};

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

for (const [title, words] of Object.entries(forms)) {
  for (const file of Object.keys(files).filter(name => name.includes(".test."))) {
    test(`${file}: ${title}`, async () => {
      using dir = tempDir("a-commonjs-test-file-that-takes-names-out-of-bun-test", files);
      const told = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, `./${file}`], String(dir), env);
        expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
        return {
          seen: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          scan: stderr.split("\n").find(line => line.startsWith("AOT test run | scan of ")) ?? "",
        };
      };
      const plain = await told();
      expect(plain.seen).toEqual(["SEEN function false", "SEEN true"]);
      const compiled = await told("--aot");
      expect(compiled.seen).toEqual(plain.seen);
      expect(compiled.scan).toContain("mocks any module false");
      expect(compiled.scan).toContain("spies on objects from somewhere false");
    });
  }
}
