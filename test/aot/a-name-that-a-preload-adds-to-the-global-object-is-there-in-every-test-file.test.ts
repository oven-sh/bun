import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file that imports nothing of the project is a program of its own in a run that is compiled as several. It is not alone in its realm: the preload and the layers
// below it run there too, and what they put on the global object is there. The build of such a file took the name for one that nobody ever stores: `undefined`.
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "package.json": `{ "type": "module" }`,
  "node_modules/paths-pkg/package.json": `{ "name": "paths-pkg", "type": "module", "main": "index.js" }`,
  "node_modules/paths-pkg/index.js": `export default name => ({ data: "/data/" + name });\nglobalThis.fromThePackage = "package";\n`,
  "src/paths.ts": `import paths from "paths-pkg";\nexport const dataOf = (name: string): string => paths("cli").data + "/" + name;\n`,
  "preload.ts": `import { dataOf } from "./src/paths";\n(globalThis as any).dataOf = dataOf;\n(globalThis as any).counter = { n: 0 };\nObject.defineProperty(globalThis, "defined", { value: "defined", configurable: true });\n`,
};
for (const name of ["a", "b", "c"]) {
  files[`${name}.test.ts`] = `import { test } from "bun:test";
declare const dataOf: (name: string) => string;
test("${name}", () => {
  console.log("SAID ${name}", (globalThis as any).dataOf("x"), dataOf("y"), typeof (globalThis as any).absent, ++(globalThis as any).counter.n, (globalThis as any).defined, (globalThis as any).fromThePackage, "dataOf" in globalThis);
});
`;
}

test("a name that a preload adds to the global object is there in every test file", async () => {
  using dir = tempDir("a-name-that-a-preload-adds-to-the-global-object", files);
  const said = async (flags: string[], words?: string) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", ...flags, "--isolate", "--preload", "./preload.ts"],
      String(dir),
      {
        ...bunEnv,
        ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}),
      },
    );
    const lines = (stdout + "\n" + stderr).split("\n");
    return {
      said: lines.filter(line => line.startsWith("SAID ")).sort(),
      summary: lines.filter(line => /^ *\d+ (pass|fail)$/.test(line)),
      exitCode,
    };
  };
  const plain = await said([]);
  expect(plain.said).toEqual(
    ["a", "b", "c"].map(name => `SAID ${name} /data/cli/x /data/cli/y undefined 1 defined package true`),
  );
  expect(plain.exitCode).toBe(0);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:1,TestRunPartFiles:1")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 120_000);
