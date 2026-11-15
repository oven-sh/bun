import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` sets a loaded file aside where a mock is laid over it. A reset does not find it there, and the end of the test file brings it back: the next test file gets the same run.
const gaugeOf = (name: string) =>
  name.endsWith(".cjs")
    ? `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.held = 1;\nexports.spare = "file";\n`
    : `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexport const held = 1;\nexport const spare = "file";\n`;

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-file-under-a-mock-at-a-reset", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.js", "./b_test.js"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

for (const gauge of ["gauge.cjs", "gauge.mjs"]) {
  test.failing(
    `${gauge}: it prints what bun test prints: a wrong answer today: under \`bun test --aot\` the file has run 2 times in the second test file, where \`bun test\` has run it once`,
    async () => {
      const project = {
        "package.json": `{ "name": "made-up", "type": "module" }\n`,
        [gauge]: gaugeOf(gauge),
        "porch.js": `export * from "./${gauge}";\n`,
        "a_test.js": `import { test, vi } from "bun:test";
import * as early from "./porch.js";
test("a mock is laid and the modules are reset", () => {
  vi.doMock("./${gauge}", () => ({ held: 10 }));
  vi.resetModules();
  console.log("SAID first", globalThis.runs, early.held);
});
`,
        "b_test.js": `import { test } from "bun:test";
import * as early from "./porch.js";
test("the next test file imports the file", () => {
  console.log("SAID next", globalThis.runs, early.held);
});
`,
      };
      const plain = await linesOf(project);
      expect(plain).toEqual(["SAID first 1 1", "SAID next 1 1"]);
      expect(await linesOf(project, "--aot")).toEqual(plain);
    },
  );
}

test.failing(
  "two test files mock a file and a barrel over it that takes its original, and reset: it prints what bun test prints: a wrong answer today: under `bun test --aot` the second says that the file has run 2 times",
  async () => {
    const deed = (word: string) => `import { test, vi } from "bun:test";
import * as early from "./porch.js";
test("${word}", async () => {
  vi.doMock("./gauge.cjs", () => ({ default: 1, held: 10 }));
  vi.doMock("./shelf.js", async original => ({ ...(await original()), added: 1 }));
  vi.resetModules();
  console.log("SAID ${word}", globalThis.runs ?? 0, (await import("./reader.js")).look());
  console.log("SAID ${word} early", Object.keys(early).sort().join());
});
`;
    const project = {
      "package.json": `{ "name": "made-up", "type": "module" }\n`,
      "gauge.cjs": gaugeOf("gauge.cjs"),
      "porch.js": `export * from "./gauge.cjs";\n`,
      "shelf.js": `export * from "./gauge.cjs";\nexport * from "./porch.js";\n`,
      "attic.js": `export * from "./shelf.js";\n`,
      "reader.js": `import * as all from "./attic.js";\nexport const look = () => Object.keys(all).sort().join() + " " + all.held;\n`,
      "a_test.js": deed("first"),
      "b_test.js": deed("next"),
    };
    const plain = await linesOf(project);
    expect(plain).toEqual([
      "SAID first 1 held 10",
      "SAID first early held,spare",
      "SAID next 1 held 10",
      "SAID next early held,spare",
    ]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);
