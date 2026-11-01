import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

// A mock of a CommonJS file puts its object where `module.exports` and `require()` find it. `exports` in the file is a parameter of the function around its text, so it goes
// on naming the object that the file began with: `exports.c(x)` in the file calls the real `c`, and `exports.added = 1` stores to the first object.
const common = `exports.c = x => x + 1;
const mine = exports;
const self = this;
exports.viaExports = x => exports.c(x);
exports.viaModule = x => module.exports.c(x);
exports.viaThis = x => self.c(x);
exports.viaKept = x => mine.c(x);
exports.viaRequire = x => require(__filename).c(x);
exports.same = () => [exports === module.exports, exports === mine, exports === self, require(__filename) === exports].join();
exports.store = () => { exports.added = 1; module.exports.added2 = 2; return Object.keys(mine).filter(k => k.startsWith("added")).join(); };
`;
const roads = `const roads = o => ["viaExports", "viaModule", "viaThis", "viaKept", "viaRequire"].map(k => k + "=" + o[k](1)).join(" ") + " same: " + o.same();`;
const whole = (
  label: string,
  path: string,
  mock: (factory: string) => string,
  imports = "mock",
) => `import { ${imports}, test } from "bun:test";
import common from ${JSON.stringify(path)};
${roads}
test(${JSON.stringify(label)}, async () => {
  const kept = { ...common };
  console.log("SAID ${label} before", roads(kept));
  ${mock(`({ ...kept, c: () => "fake" })`)};
  console.log("SAID ${label} after", common.c(1), roads(kept));
  console.log("SAID ${label} stores", kept.store(), Object.keys(common).filter(k => k.startsWith("added")).join());
});
`;
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "common.cjs": common,
  "src/common.cjs": common,
  "node_modules/pkg/package.json": `{"name":"pkg","main":"common.cjs"}`,
  "node_modules/pkg/common.cjs": common,
  "beside.test.mjs": whole("beside", "./common.cjs", factory => `mock.module("./common.cjs", () => ${factory})`),
  "src.test.mjs": whole("src", "./src/common.cjs", factory => `mock.module("./src/common.cjs", () => ${factory})`),
  "package.test.mjs": whole("package", "pkg", factory => `mock.module("pkg", () => ${factory})`),
  "async.test.mjs": whole(
    "async",
    "./common.cjs",
    factory => `await mock.module("./common.cjs", async () => ${factory})`,
  ),
  "jest.test.mjs": whole("jest", "./common.cjs", factory => `jest.mock("./common.cjs", () => ${factory})`, "jest"),
  "unknown.test.mjs": whole(
    "unknown",
    "./common.cjs",
    factory =>
      `({ mock(path, made) { return mock.module(path, made); } }).mock(import.meta.dirname + "/common.cjs", () => ${factory})`,
  ),
  "names.test.mjs": `import { mock, test } from "bun:test";
import { c, viaExports, viaModule, viaKept } from "./common.cjs";
test("names", () => {
  const real = { c, viaExports, viaModule, viaKept };
  mock.module("./common.cjs", () => ({ ...real, c: () => "fake" }));
  console.log("SAID names", c(1), viaExports(1), viaModule(1), viaKept(1), real.viaExports(1));
});
`,
};

async function said(flags: string[], words: string) {
  const directory = String(dir);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
  const ran = await run([bunExe(), "test", ...flags, "--isolate", "--parallel=1", "."], directory, env);
  return {
    lines: ran.stdout
      .split("\n")
      .filter(line => line.startsWith("SAID"))
      .sort(),
    summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
  };
}

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof said>>;
beforeAll(async () => {
  dir = tempDir("aot-mocked-commonjs-own-exports", files);
  plain = await said([], "");
});
afterAll(() => dir?.[Symbol.dispose]());

test("what plain Bun says", () => {
  expect(plain.summary).toEqual([" 7 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(19);
  expect(plain.lines).toContain(
    "SAID beside after 2 viaExports=2 viaModule=fake viaThis=2 viaKept=2 viaRequire=fake same: false,true,true,false",
  );
});

test.each([
  ["as one program", "TestRunLayers:0"],
  ["in one layer", "TestRunLayers:1,TestRunPartFiles:1"],
  ["in two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("it says what plain Bun says, %s", async (_, words) => {
  expect(await said(["--aot"], words)).toEqual(plain);
});
