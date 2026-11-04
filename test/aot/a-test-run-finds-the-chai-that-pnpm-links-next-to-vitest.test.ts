// `import { assert } from "vitest"` reads `assert` off "chai". pnpm links chai next to vitest, where a lookup from the importer
// does not pass, so the loader looks again from the folder of vitest. A module that a test writes is loaded from disk by the
// loader of the run, under --aot as without it: both say the same.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const store = "node_modules/.pnpm/vitest@1.0.0/node_modules";
const files = {
  "suite/package.json": JSON.stringify({ name: "suite", type: "module" }),
  "suite/tsconfig.json": "{}",
  [`suite/${store}/vitest/package.json`]: JSON.stringify({
    name: "vitest",
    exports: { "./package.json": "./package.json" },
  }),
  [`suite/${store}/chai/package.json`]: JSON.stringify({ name: "chai", type: "module", main: "index.js" }),
  [`suite/${store}/chai/index.js`]: `export const assert = () => "the chai next to vitest";\nexport const should = () => "";\n`,
  // A project where vitest, and then its chai, are installed while the tests run.
  [`late/${store}/vitest/.keep`]: "",
  "suite/a.test.ts": `import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

test("a module that the test writes imports assert from vitest", async () => {
  const made = join(import.meta.dirname, "made.mjs");
  writeFileSync(made, 'import { assert } from "vitest";\\nexport const said = assert();\\n');
  try {
    console.log("SAID a written module:", (await import(made)).said);
  } catch (error: any) {
    console.log("SAID a written module: THROWS", error.code);
  }
});

test("vitest and then its chai are installed while the tests run", () => {
  const root = dirname(import.meta.dirname);
  const project = join(root, "late");
  const store = join(project, ${JSON.stringify(store)});
  const ask = (label: string) => {
    try {
      console.log("SAID", label, Bun.resolveSync("chai", project).slice(root.length).replaceAll("\\\\", "/"));
    } catch (error: any) {
      console.log("SAID", label, "THROWS", error.code);
    }
  };
  ask("before");
  writeFileSync(join(store, "vitest", "package.json"), '{ "name": "vitest", "exports": { "./package.json": "./package.json" } }');
  ask("with vitest");
  mkdirSync(join(store, "chai"));
  writeFileSync(join(store, "chai", "package.json"), '{ "name": "chai", "main": "index.js" }');
  writeFileSync(join(store, "chai", "index.js"), "exports.assert = () => 1;");
  ask("with chai");
});
`,
};

test("it says what plain Bun says", async () => {
  const said = async (flags: string[]) => {
    // A run leaves what it has written, so each gets a folder of its own.
    using dir = tempDir("aot-chai-next-to-vitest", files);
    for (const project of ["suite", "late"]) {
      symlinkSync(
        join(String(dir), project, store, "vitest"),
        join(String(dir), project, "node_modules", "vitest"),
        "junction",
      );
    }
    const ran = await run([bunExe(), "test", ...flags], join(String(dir), "suite"));
    return {
      lines: ran.stdout.split("\n").filter(line => line.startsWith("SAID")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([]);
  expect(plain).toEqual({
    lines: [
      "SAID a written module: the chai next to vitest",
      "SAID before THROWS ERR_MODULE_NOT_FOUND",
      "SAID with vitest THROWS ERR_MODULE_NOT_FOUND",
      `SAID with chai /late/${store}/chai/index.js`,
    ],
    summary: [" 2 pass", " 0 fail"],
  });
  expect(await said(["--aot"])).toEqual(plain);
});
