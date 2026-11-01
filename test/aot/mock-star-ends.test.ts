// barrel.js says `export * from "./leaf.cjs"`, and a mock is laid over barrel.js when it has run. The values of the mock go over names that leaf.cjs holds.
// When the mock ends, at the end of the test file or by mock.restore(), whoever reads those names reads the file's own values again.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const head = `import { mock, test } from "bun:test";
import { seen } from "./user.js";
`;
const factory = `() => ({ x: "mock x", f: () => "mock f" })`;
const nextFile = `${head}test("z", async () => console.log("OUT z", seen(), (await import("./barrel.js")).x, require("LEAF").x));`;
const leaf = `exports.x = "real x";
exports.f = () => "real f";`;

const projects = {
  "the test file ends": {
    "a.test.js": `${head}mock.module("./barrel.js", ${factory});
test("a", () => console.log("OUT a", seen()));`,
  },
  "mock.restore()": {
    "a.test.js": `${head}test("a", () => {
  mock.module("./barrel.js", ${factory});
  console.log("OUT a", seen());
  mock.restore();
  console.log("OUT a restored", seen());
});`,
  },
  "mocked again in the next file": {
    "a.test.js": `${head}mock.module("./barrel.js", ${factory});
test("a", () => console.log("OUT a", seen()));`,
    "m.test.js": `${head}test("m", () => {
  console.log("OUT m", seen());
  mock.module("./barrel.js", () => ({ x: "second x" }));
  console.log("OUT m mocked", seen());
});`,
  },
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

const places = { "a file": "./leaf.cjs", "a package": "pkg" };
const ways = { "as one program": "TestRunLayers:0", "over two layers": "TestRunLayers:2" };
const cases = Object.keys(projects).flatMap(name =>
  Object.keys(places).flatMap(place => Object.keys(ways).map(way => [name, place, way] as const)),
);

test.concurrent.each(cases)(
  "%s, the names of %s, %s",
  async (name, place, way) => {
    const from = places[place as keyof typeof places];
    using folder = tempDir("aot-mock-star-ends", {
      "package.json": `{ "name": "mock-star-ends", "type": "module" }`,
      "leaf.cjs": leaf,
      "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
      "node_modules/pkg/index.js": leaf,
      "barrel.js": `export * from "${from}";
export const own = "own";`,
      "barrel2.js": `export * from "./barrel.js";`,
      "user.js": `import * as all from "./barrel2.js";
import { x } from "./barrel.js";
const key = JSON.parse('"x"');
export const seen = () => [all.x, all[key], x, all.f(), all.own].join();`,
      "z.test.js": nextFile.replace("LEAF", from),
      ...projects[name as keyof typeof projects],
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.find(line => line.startsWith("OUT a "))).toBe("OUT a mock x,mock x,mock x,mock f,own");
    expect(plain.lines.at(-1)).toBe("OUT z real x,real x,real x,real f,own real x real x");
    const compiled = await run(dir, ["--aot"], ways[way as keyof typeof ways]);
    expect(compiled).toEqual(plain);
  },
  240_000,
);
