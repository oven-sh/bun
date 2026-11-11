import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = {
  "package.json": `{ "name": "made-up-in-flight" }\n`,
  "m.js": `export const x = "real x";\n`,
  "a_test.js": `import { test, vi } from "bun:test";
test("t", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  vi.doMock("./m.js", () => { called.resolve(); return answer.promise; });
  const first = import("./m.js").then(it => it.x);
  await called.promise;
  vi.doMock("./m.js", () => { calls++; return { x: "new x" }; });
  const second = answer.promise.then(() => 0).then(() => 0).then(() => 0).then(() => 0).then(() => 0).then(() => 0).then(() => 0).then(() => 0).then(() => import("./m.js")).then(it => it.x);
  answer.resolve({ x: "old x" });
  const one = await first, two = await second;
  console.log(\`SAID \${one} | \${two} | \${(await import("./m.js")).x} \${calls}\`);
});
`,
};

async function linesOf(...flags: string[]) {
  using dir = tempDir("aot-eight-jobs-behind-the-old-answer", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.js"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

const said = ["SAID old x | new x | new x 1"];

test("bun test gives the second import the new mock from the eighth job on", async () => {
  expect(await linesOf()).toEqual(said);
});

test("the compiled run prints what bun test prints", async () => {
  expect(await linesOf("--aot")).toEqual(said);
});
