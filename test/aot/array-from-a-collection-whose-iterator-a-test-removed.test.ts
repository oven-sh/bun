import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const attempt = `const attempt = (what, act) => { try { console.log("SAID " + what + ": " + JSON.stringify(act())); } catch (e) { console.log("SAID " + what + ": threw " + e.constructor.name); } };`;
const asks = (name: string) => `
  attempt("${name} map", () => Array.from(new Map([[1, 2]])));
  attempt("${name} set", () => Array.from(new Set([1, 2])));
  attempt("${name} spread map", () => [...new Map([[1, 2]])]);
  attempt("${name} spread set", () => [...new Set([1, 2])]);`;
const files = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "untouched.test.js": `import { test } from "bun:test";
${attempt}
test("untouched", () => {${asks("untouched")}
});
`,
  "deleted.test.js": `import { test } from "bun:test";
${attempt}
test("deleted", () => {
  delete Map.prototype[Symbol.iterator];${asks("without Map's")}
  delete Set.prototype[Symbol.iterator];${asks("without both")}
});
`,
  "undefined.test.js": `import { test } from "bun:test";
${attempt}
test("undefined", () => {
  Map.prototype[Symbol.iterator] = undefined;
  Set.prototype[Symbol.iterator] = null;${asks("undefined and null")}
});
`,
  "replaced.test.js": `import { test } from "bun:test";
${attempt}
test("replaced", () => {
  Map.prototype[Symbol.iterator] = function* () { yield "from the map"; };
  Set.prototype[Symbol.iterator] = function* () { yield "from the set"; };${asks("replaced")}
});
`,
  "unspelled.test.js": `import { test } from "bun:test";
${attempt}
const named = name => globalThis[["", name].join("")];
test("unspelled", () => {
  delete named("Map").prototype[Symbol.iterator];
  delete named("Set").prototype[Symbol.iterator];${asks("unspelled")}
});
`,
};

test("Array.from(new Map(..)) and Array.from(new Set(..)) answer as plain Bun does", async () => {
  using dir = tempDir("aot-array-from-without-an-iterator", files);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: String(dir) };
    const ran = await run([bunExe(), "test", ...flags, "--isolate", "."], String(dir), env);
    return {
      lines: ran.stdout.split("\n").filter(line => line.startsWith("SAID")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 5 pass", " 0 fail"]);
  expect(plain.lines).toContain("SAID without Map's map: []");
  expect(plain.lines.length).toBe(24);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
