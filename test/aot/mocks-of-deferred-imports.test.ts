import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const factory = `() => ({ flag: "mock" })`;
const mocks = {
  "jest.mock()": (path: string) => `jest.mock("${path}", ${factory});`,
  "mock.module()": (path: string) => `mock.module("${path}", ${factory});`,
  "vi.mock()": (path: string) => `vi.mock("${path}", ${factory});`,
};
const kinds = {
  "an ES module": { path: "./dep.mjs", text: `export const flag = "real";\nexport const other = 1;` },
  "a CommonJS file": { path: "./dep.cjs", text: `exports.flag = "real";\nexports.other = 1;` },
};

async function compare(files: Record<string, string>, expected: string[]) {
  using directory = tempDir("mocks-of-deferred-imports", { "package.json": `{ "name": "p" }`, ...files });
  const plain = await run([bunExe(), "test", "./a.test.mjs"], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", "./a.test.mjs"], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(expected);
  expect(said(stdout)).toEqual(expected);
  expect(stdout + stderr).toContain(" 1 pass");
}

for (const [kind, { path, text }] of Object.entries(kinds)) {
  for (const [name, mock] of Object.entries(mocks)) {
    test.each(["before", "after"])(
      `${name} of ${kind} that \`import defer\` imports, %s its first read`,
      async order => {
        const read = order === "after" ? `  console.log("SAID first", d.flag);\n` : "";
        await compare(
          {
            [path.slice(2)]: `console.log("SAID dep runs");\n${text}`,
            "a.test.mjs": `import { jest, mock, test, vi } from "bun:test";
import defer * as d from "${path}";
test("t", async () => {
${read}  ${mock(path)}
  console.log("SAID mocked");
  console.log("SAID deferred", d.flag, d.other);
  console.log("SAID imported", (await import("${path}")).flag, d.flag);
});`,
          },
          order === "after"
            ? ["SAID dep runs", "SAID first real", "SAID mocked", "SAID deferred mock 1", "SAID imported mock mock"]
            : ["SAID dep runs", "SAID mocked", "SAID deferred mock 1", "SAID imported mock mock"],
        );
      },
    );
  }
}

test("jest.mock() of a file below one that `import defer` imports", async () => {
  await compare(
    {
      "low.mjs": `console.log("SAID low runs");\nexport const low = "real";`,
      "dep.mjs": `import { low } from "./low.mjs";\nconsole.log("SAID dep runs", low);\nexport const read = () => low;`,
      "a.test.mjs": `import { jest, test } from "bun:test";
import defer * as d from "./dep.mjs";
test("t", async () => {
  jest.mock("./low.mjs", () => ({ low: "mock" }));
  console.log("SAID mocked");
  console.log("SAID", d.read(), (await import("./low.mjs")).low);
});`,
    },
    ["SAID low runs", "SAID mocked", "SAID dep runs mock", "SAID mock mock"],
  );
});

test.each(Object.entries(mocks))("%s in a preload, of a file that `import defer` imports", async (_, mock) => {
  await compare(
    {
      "bunfig.toml": `[test]\npreload = ["./preload.mjs"]`,
      "preload.mjs": `import { jest, mock, vi } from "bun:test";\n${mock("./dep.mjs")}`,
      "dep.mjs": `console.log("SAID dep runs");\nexport const flag = "real";`,
      "a.test.mjs": `import { test } from "bun:test";
import defer * as d from "./dep.mjs";
test("t", async () => {
  console.log("SAID", d.flag, Object.keys(d).join(), (await import("./dep.mjs")).flag);
});`,
    },
    ["SAID mock flag mock"],
  );
});
