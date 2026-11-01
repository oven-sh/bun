// A test file imports a helper that mocks a package, and beside it a file that comes to that package through another file. The whole graph is linked before the helper
// runs, so `bun test` runs the body of the package ahead of the mock and lays the mock over it. Over layers the package, the files of the project and the test file lie
// in three images. The image of the package looked for importers under evaluation in each image above by itself, found none, and took the mock for one that comes ahead
// of the load: the body never ran, importOriginal() never settled, and the test read `Cannot access 'default' before initialization`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ran = (file: string) => `console.log("OUT ran ${file}");`;
const packageOf = (name: string, text: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "type": "module", "exports": "./index.ts" }`,
  [`node_modules/${name}/index.ts`]: `${ran(name)} ${text}`,
});
const factory = `async importOriginal => {
  const actual: any = await importOriginal();
  console.log("OUT has the original", typeof actual.default);
  return { ...actual, default: (key: string) => "wrapped " + actual.default(key) };
}`;
const shared = {
  "package.json": `{ "name": "mock-linked-layers", "type": "module" }`,
  ...packageOf("core", `export const create = (name: string) => (key: string) => name + " " + key;`),
  ...packageOf("confirm", `import { create } from "core"; export default create("confirm");`),
  ...packageOf("select", `import { create } from "core"; export default create("select");`),
  "demo.ts": `${ran("demo")} import { confirm, select } from "./prompts.ts"; export default () => confirm("enter") + " | " + select("up");`,
  "prompts.ts": `${ran("prompts")} export { default as confirm } from "confirm"; export { default as select } from "select";`,
};
const testFile = (helper: string) => `${ran("the test file")}
import { test } from "bun:test";
import "${helper}";
import demo from "./demo.ts";
test("t", () => {
  console.log("OUT", demo());
});`;
const helper = (name: string, call: string, mocked: string[]) =>
  `${ran(name)} import { mock, vi } from "bun:test"; ${mocked.map(each => `${call}("${each}", ${factory});`).join(" ")}`;

const projects: Record<string, [Record<string, string>, string[]]> = {
  "a file of the project mocks": [
    { ...shared, "helper.ts": helper("helper", "vi.mock", ["confirm"]), "demo.test.ts": testFile("./helper.ts") },
    ["core", "confirm", "helper", "select", "prompts", "demo", "the test file"],
  ],
  "a package mocks two": [
    { ...shared, ...packageOf("helper", helper("", "vi.mock", ["confirm", "select"]).slice(ran("").length)), "demo.test.ts": testFile("helper") }, // prettier-ignore
    ["core", "confirm", "select", "helper", "prompts", "demo", "the test file"],
  ],
  "mock.module()": [
    { ...shared, "helper.ts": helper("helper", "mock.module", ["select"]), "demo.test.ts": testFile("./helper.ts") },
    ["helper", "core", "select", "confirm", "prompts", "demo", "the test file"],
  ],
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.each(Object.keys(projects))(
  "%s",
  async name => {
    const [files, order] = projects[name];
    using folder = tempDir("aot-mock-linked-layers", files);
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.filter(line => line.startsWith("OUT ran ")).map(line => line.slice(8))).toEqual(order);
    expect(plain.lines.at(-1)).toContain("wrapped ");
    expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  240_000,
);
