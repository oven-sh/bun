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
  "before anything has imported it": path => `
import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("${path}", () => ({ flag: "a", more: 1 }));
  const all = await import("${path}");
  console.log("SEEN a", Object.keys(all).join(), all.flag);
});`,
};

const inPackage = (name: string, text: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  [`node_modules/${name}/index.js`]: text,
});
const readsThroughPackage = (file: string) => `
import { test } from "bun:test";
import { seen } from "reads";
import { flag } from "dep";
test("${file}", () => console.log("SEEN ${file}", seen(), flag));`;

// On a build without the cure the next file read the mock of the file before it, as one program and over layers alike.
const nextFileProjects = (
  [
    ["dep.js", "hoisted"],
    ["dep.cjs", "before anything has imported it"],
  ] as const
).map(
  ([name, how]) =>
    [
      `the next file has the mock of the preload again: ${name}, ${how}`,
      /^SEEN [bd] .* preload preload preload$/,
      {
        "package.json": `{ "name": "mock-preload-back" }`,
        "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
        "setup.js": `import { vi } from "bun:test";\nvi.mock("./${name}", () => { console.log("SEEN the factory of the preload runs"); return { flag: "preload" }; });`,
        [name]: dep[name],
        "a.test.js": displaces[how](`./${name}`),
        "b.test.js": reads("b", `./${name}`),
        "c.test.js": displaces[how](`./${name}`).replaceAll("SEEN a", "SEEN c"),
        "d.test.js": reads("d", `./${name}`),
      },
    ] as const,
);

const projects = [
  ...nextFileProjects,
  [
    "a package that imports what the preload mocks has the original",
    /^SEEN [ab] real preload$/,
    {
      "package.json": `{ "name": "mock-preload-back", "type": "module" }`,
      "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
      "setup.js": `import { vi } from "bun:test";\nvi.mock("dep", () => ({ flag: "preload" }));`,
      ...inPackage("dep", `console.log("SEEN dep runs"); export const flag = "real";`),
      ...inPackage("reads", `import { flag } from "dep";\nexport const seen = () => flag;`),
      "a.test.js": readsThroughPackage("a"),
      "b.test.js": readsThroughPackage("b"),
    },
  ],
] as const;

test.concurrent.each(projects)("%s", async (_, expected, files) => {
  using dir = tempDir("mock-preload-back", files);
  const seenWith = async (env: Record<string, string>, ...more: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), { ...bunEnv, ...env });
    return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const plain = await seenWith({});
  expect(plain.seen.filter(line => expected.test(line))).toHaveLength(2);
  expect(plain.exitCode).toBe(0);
  expect(await seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot")).toEqual(plain);
});
