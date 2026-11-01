import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const dep = {
  "dep.js": `console.log("SEEN dep.js runs"); export const flag = "real";`,
  "dep.cjs": `console.log("SEEN dep.cjs runs"); exports.flag = "real";`,
};
const reads = (file: string, path: string) => `
import { test } from "bun:test";
import * as all from "${path}";
import { flag } from "${path}";
test("${file}", () => console.log("SEEN ${file}", Object.keys(all).join(), all.flag, flag, require("${path}").flag));`;
const displaces: Record<string, (path: string) => string> = {
  hoisted: path => `
import { test, vi } from "bun:test";
import * as all from "${path}";
vi.mock("${path}", () => ({ flag: "a", more: 1 }));
test("a", () => console.log("SEEN a", Object.keys(all).join(), all.flag));`,
  "in a test, behind the preload's": path => `
import { test, mock } from "bun:test";
import * as all from "${path}";
test("a", () => {
  console.log("SEEN a", Object.keys(all).join(), all.flag);
  mock.module("${path}", () => ({ flag: "a", more: 1 }));
  console.log("SEEN a", Object.keys(all).join(), all.flag);
});`,
  "before anything has imported it": path => `
import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("${path}", () => ({ flag: "a", more: 1 }));
  const all = await import("${path}");
  console.log("SEEN a", Object.keys(all).join(), all.flag);
});`,
  twice: path => `
import { test, vi } from "bun:test";
import * as all from "${path}";
test("a", () => {
  vi.mock("${path}", () => ({ flag: "a", more: 1 }));
  vi.mock("${path}", () => ({ flag: "a again", other: 1 }));
  console.log("SEEN a", Object.keys(all).join(), all.flag);
});`,
};

const projects = Object.entries(dep).flatMap(([name, text]) =>
  Object.entries(displaces).map(
    ([how, displace]) =>
      [
        `${name}, ${how}`,
        {
          "package.json": `{ "name": "mock-preload-back" }`,
          "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
          "setup.js": `import { vi } from "bun:test";\nvi.mock("./${name}", () => { console.log("SEEN the factory of the preload runs"); return { flag: "preload" }; });`,
          [name]: text,
          "a.test.js": displace(`./${name}`),
          "b.test.js": reads("b", `./${name}`),
          "c.test.js": displace(`./${name}`).replaceAll("SEEN a", "SEEN c"),
          "d.test.js": reads("d", `./${name}`),
        },
      ] as const,
  ),
);

test.concurrent.each(projects)("the next file has the mock of the preload again: %s", async (_, files) => {
  using dir = tempDir("mock-preload-back", files);
  const seenWith = async (env: Record<string, string>, ...more: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), { ...bunEnv, ...env });
    return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const plain = await seenWith({});
  expect(plain.seen.filter(line => /^SEEN [bd] .* preload preload preload$/.test(line))).toHaveLength(2);
  expect(plain.exitCode).toBe(0);
  expect(await seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot")).toEqual(plain);
  expect(await seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot")).toEqual(plain);
});
