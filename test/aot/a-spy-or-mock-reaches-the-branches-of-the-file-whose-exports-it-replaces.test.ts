import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = join(
  import.meta.dir,
  "parallel/modules/a-mock-reaches-the-branches-of-the-file-whose-exports-it-replaces",
);
const moduleText = await Bun.file(join(program, "flags.mjs")).text();

const helpers = `const show = value => (typeof value === "function" ? "function" : String(value).replace(/function.*/, "function"));
function state(held) {
  const answers = [];
  for (const name of Object.keys(held).sort()) {
    if (typeof held[name] !== "function" || name === "first") continue;
    answers.push(name + "=" + show(name === "Reader" ? new held.Reader().read() : held[name]()));
  }
  return answers.join(" ");
}
`;

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/behind-a-branch.cjs": await Bun.file(join(program, "behind-a-branch.cjs")).text(),
  "src/mocked.mjs": moduleText,
  "src/spied.mjs": moduleText,
  "src/handed-on.mjs": moduleText,
  "src/hands-on.mjs": `export { enabled, level as depth } from "./handed-on.mjs";\n`,
  "mock.test.mjs": `import { test, mock } from "bun:test";
${helpers}
test("a mock", async () => {
  const held = { ...(await import("./src/mocked.mjs")) };
  console.log("before the mock:", state(held));
  mock.module("./src/mocked.mjs", () => ({ enabled: true, level: 2, label: "mocked", nothing: 0, table: null, storedOnce: 2, declaredWithVar: 2, renamed: 2, default: 2 }));
  console.log("mocked:", state(held));
});
`,
  "handed-on.test.mjs": `import { test, mock } from "bun:test";
${helpers}
test("a mock of a file that hands the names on", async () => {
  const held = { ...(await import("./src/handed-on.mjs")) };
  await import("./src/hands-on.mjs");
  mock.module("./src/hands-on.mjs", () => ({ enabled: true, depth: 2 }));
  console.log("mocked where the names are handed on:", state(held));
});
`,
  "spy.test.mjs": `import { test, spyOn } from "bun:test";
${helpers}
test("spies", async () => {
  const ns = await import("./src/spied.mjs");
  const held = { ...ns };
  const names = ["enabled", "level", "nothing", "table", "storedOnce", "declaredWithVar", "renamed"];
  const spies = names.map(name => spyOn(ns, name));
  console.log("spied:", state(held));
  for (const spy of spies) spy.mockRestore();
  console.log("restored:", state(held));
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a file decides its branches by what a spy or a mock stored in its exported variables, ${way}`, async () => {
    using dir = tempDir("aot-a-spy-or-mock-reaches-the-branches", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain(
      "mocked: Reader=on and=2 chain=undefined chosen=case two computedOnce=two conditional=on copy=one declared=on earlyReturn=other:2 hoisted=other:2 kind=number loaded=loaded not=false notExported=one nullish=0 object=no table once=other:2 or=true text=mocked:6 turns=3 underAnotherName=other:2",
    );
    expect(plain.stdout).toContain(
      "mocked where the names are handed on: Reader=on and=2 chain=1 chosen=case two computedOnce=two conditional=on copy=one declared=on earlyReturn=other:2 hoisted=one kind=number loaded=loaded not=false notExported=one nullish=nothing object=table once=one or=true text=plain:5 turns=3 underAnotherName=one",
    );
    expect(plain.stdout).toContain(
      "spied: Reader=on and=function chain=undefined chosen=no case computedOnce=two conditional=on copy=one declared=on earlyReturn=other:function hoisted=other:function kind=function loaded=loaded not=false notExported=one nullish=function object=table once=other:function or=function text=plain:5 turns=3 underAnotherName=other:function",
    );
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
