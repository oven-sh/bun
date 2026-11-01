// A run of many test files is compiled as several programs: the packages, the rest of what the tests import, the test files. The build of a lower program
// does not see the programs above it, which call what it exports. Here `load` is called by the test file alone, and the package behind the file that it
// loads is reached by nothing else. Flow once let go of such an export where its rules ran in one of the orders that are as good as the usual one:
// "'load' was not compiled into this executable because your code never calls it".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/one-pkg/package.json": `{ "name": "one-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/one-pkg/index.js": `export const one = x => "one<" + x;`,
  "node_modules/two-pkg/package.json": `{ "name": "two-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/two-pkg/index.js": `export default function f(x) { return "f(" + x + ")"; }`,
  "src/direct.js": `import { one } from "one-pkg";\nexport const direct = one("d");`,
  "src/late.js": `import f from "two-pkg";\nexport const made = f("late");`,
  "src/loads.js": `export const load = () => import("./late.js");`,
  "a.test.js": `
    import { test } from "bun:test";
    import { direct } from "./src/direct.js";
    import { load } from "./src/loads.js";
    test("a", async () => {
      let said;
      try { said = (await load()).made; } catch (error) { said = "THREW " + String(error.message).slice(0, 90); }
      console.log("SEEN", JSON.stringify([direct, said]));
    });`,
};

const orders = [
  "",
  "testing=DelayOtherFlowRules",
  "testing=DelayFlowRules",
  "testing=DelayFlowRules:7",
  "testing=DelayFlowRules:200",
];

test.each(orders)(
  "an export that only the test file calls, over two layers: the order of flow's rules %j",
  async order => {
    using dir = tempDir("a-layer-keeps-what-only-the-programs-above-call", files);
    const seen = async (...flags: string[]) => {
      const words = ["TestRunLayers:2", "TestRunPartFiles:1", order].filter(Boolean).join(",");
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "test", ...flags, "--isolate", "--parallel=2"],
        String(dir),
        env,
      );
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n").filter(line => line.startsWith("SEEN"));
    };
    expect(await seen("--aot")).toEqual(await seen());
    expect(await seen()).toEqual([`SEEN ["one<d","f(late)"]`]);
  },
);

// What a reducer left of a generated project. Two test files of one program name no helper in an import statement, and they alone call what they load under a
// computed name. Tidier forms did not show the fault, so the text stays as it was found: its tests fail in plain Bun too, and only the missing export counts.
const reduced = {
  "setup.ts": "",
  "helpers/math.ts": `export function add(a: number, b: number): number { return a + b; }`,
  "file0.test.tsx": `const note = (label: string, ...values: unknown[]) => { seen.push(label + ": " + joinOf.call(mapOf.call(values, show), " ")); };
test.if(true)("an import under a computed name 0", async () => {
  const name = ["ma", "th"].join(""); const loaded: any = await import("./helpers/" + name + ".ts"); note("imported", loaded.add(7, 1), loaded.default(2));
});`,
  "file1.test.mts": `const store = (path: any, text: any) => require("node:fs").writeFileSync(path, text), asText = JSON.stringify, isList = Array.isArray, joinOf = Array.prototype.join, mapOf = Array.prototype.map;
afterAll(async () => { for (const ask of leftReplaced) { try { note("left replaced", ask()); } catch (error) { note("left replaced", error); } } await store(process.env.SEEN_IN + "/file1.test.mts.json", asText(seen, null, 1)); });
describe("a group", () => {
test("an import under a computed name 2", async () => {
  for (const each of ["state.js", "counters.ts", "missing.js"]) { try { note(each, Object.keys(await import(\`./helpers/\${each}\`)).sort().join()); } catch (error: any) { note(each, error.name); } }
});
});`,
};

test.each(["", "testing=DelayFlowRules:3", "testing=DelayOtherFlowRules"])(
  "an export behind a computed name, two test files to a program: the order of flow's rules %j",
  async order => {
    using dir = tempDir("an-export-behind-a-computed-name", reduced);
    const words = ["TestRunLayers:2", "TestRunPartFiles:2", order].filter(Boolean).join(",");
    const { stdout, stderr } = await run(
      [bunExe(), "test", "--aot", "--isolate", "--parallel=4", "--preload", "./setup.ts"],
      String(dir),
      { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    );
    const said = stdout + stderr;
    expect(said).toContain("layers 2 | test files 2 | to a program 2");
    expect(said).toContain("an import under a computed name 0");
    expect(said).not.toContain("was not compiled into this executable");
  },
);
