// A test file lists a folder and imports each file in it. Where the build can follow the path, those files are compiled with the tests, and the build reads what they spy on and
// mock. Where it can't, the loader brings them when the tests run, and what such a file spies on or mocks was built closed. The refusal said "Spell out the module and the name
// where the spy is made", which the file had done. It names the file now, and says how to load it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);
// Each case is a project of its own, in folders of its own.
const test = oneAtATime.concurrent;

const spies = `import { spyOn } from "bun:test";
import * as sums from "../../src/sums";
export function row() { spyOn(sums, "half").mockReturnValue(-3); }
`;

const project = (above: string, loads: string, helper: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "src/sums.ts": `export function half(n: number) { return n / 2; }\n`,
  "src/user.ts": `import { half } from "./sums";\nexport function all(): unknown[] { return [half(2)]; }\n`,
  "test/rows/one.rows.ts": helper,
  "test/one.test.ts": `import { test } from "bun:test";
${above}
test("t", async () => {
  ${loads}
  const { all } = await import("../src/user");
  console.log("SEEN", JSON.stringify(all()));
});
`,
});

const listed = `import { readdirSync } from "fs";\nimport path from "path";\n`;
const eachListed = (path: string) =>
  `for (const name of readdirSync(import.meta.dir + "/rows")) (await import(${path})).row();`;
const eachFound = (folder: string, path: string) =>
  `for (const name of new Glob("*.rows.ts").scanSync(${folder})) (await import(${path})).row();`;
const toPath = `import { fileURLToPath } from "url";\n`;

const followed: Record<string, [above: string, loads: string]> = {
  "import.meta.dir and a name that Bun.Glob finds": [
    `import { Glob } from "bun";\nconst folder = import.meta.dir + "/rows/";`,
    eachFound("folder", "folder + name"),
  ],
  "import.meta.dir and a name that readdirSync() lists": [
    `${listed}const folder = import.meta.dir + "/rows/";`,
    eachListed("folder + name"),
  ],
  // What the refusal says to write.
  "import.meta.dir, a folder and a name, written where they are used": [
    listed,
    eachListed(`import.meta.dir + "/rows/" + name`),
  ],
  "a relative text and a name": [
    `import { Glob } from "bun";`,
    eachFound(`import.meta.dir + "/rows"`, `"./rows/" + name`),
  ],
  "the path of a URL that holds the name": [
    listed + toPath,
    eachListed(`fileURLToPath(new URL("./rows/" + name, import.meta.url))`),
  ],
  "the href of a URL that holds the name": [listed, eachListed(`new URL("./rows/" + name, import.meta.url).href`)],
  "a written import()": ["", `(await import("./rows/one.rows.ts")).row();`],
  "an import statement": [`import { row } from "./rows/one.rows.ts";`, "row();"],
};

const folderOf = (text: string) => `const folder = fileURLToPath(new URL(${text}, import.meta.url));`;
const notFollowed: Record<string, [above: string, loads: string]> = {
  "with a name that Bun.Glob finds": [
    `import { Glob } from "bun";\n${toPath}${folderOf(`"./rows/"`)}`,
    eachFound("folder", "folder + name"),
  ],
  "that ends in a slash, with a name behind it": [listed + toPath + folderOf(`"./rows/"`), eachListed("folder + name")],
  "with a slash and a name behind it": [listed + toPath + folderOf(`"./rows"`), eachListed(`folder + "/" + name`)],
  "that ends in a slash, joined with a name": [
    listed + toPath + folderOf(`"./rows/"`),
    eachListed("path.join(folder, name)"),
  ],
  "joined with a name": [listed + toPath + folderOf(`"./rows"`), eachListed("path.join(folder, name)")],
  "that is written where it is used": [
    listed + toPath,
    eachListed(`fileURLToPath(new URL("./rows/", import.meta.url)) + name`),
  ],
  "that node:url turns into a path": [
    `${listed}import { fileURLToPath } from "node:url";\n${folderOf(`"./rows/"`)}`,
    eachListed("folder + name"),
  ],
  "of which the pathname is taken": [
    `${listed}const folder = new URL("./rows/", import.meta.url).pathname;`,
    eachListed("folder + name"),
  ],
};

async function ran(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-file-outside-the-build", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
  const ownFile = /"[^"]*\/(src\/sums\.ts|test\/rows\/one\.rows\.ts)"/g;
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("SEEN")),
    refused: stderr
      .split("\n")
      .filter(line => line.startsWith("TypeError: "))
      .map(line => line.replaceAll("\\", "/").replace(ownFile, `"<project>/$1"`)),
    exitCode,
  };
}
const asPlain = { seen: ["SEEN [-3]"], refused: [], exitCode: 0 };

const because = (made: string) =>
  `because "<project>/test/rows/one.rows.ts", which makes the ${made}, wasn't compiled with your tests: the build couldn't follow the path that loads it. ` +
  `Import that file by a constant path, or put its path together from import.meta.dir: import(import.meta.dir + "/folder/" + name) ` +
  `(https://bun.com/docs/compiler/debugging#run-your-tests-compiled)`;
const refusedSpy = `TypeError: Cannot spy on 'half' of "<project>/src/sums.ts" ${because("spy")}`;
const refusedMock = `TypeError: mock(module, fn) cannot replace "<project>/src/sums.ts" ${because("mock")}`;

for (const [title, [above, loads]] of Object.entries(followed))
  test(`the build follows ${title}, and the spy of the file is laid`, async () => {
    const files = project(above, loads, spies);
    expect(await ran(files)).toEqual(asPlain);
    expect(await ran(files, "--aot")).toEqual(asPlain);
  });

for (const [title, [above, loads]] of Object.entries(notFollowed))
  test(`the build does not follow a folder out of a URL ${title}, and the refusal names the file`, async () => {
    const files = project(above, loads, spies);
    expect(await ran(files)).toEqual(asPlain);
    expect(await ran(files, "--aot")).toEqual({ seen: [], refused: [refusedSpy], exitCode: 1 });
  });

test.each([
  [
    "jest.spyOn()",
    `import { jest } from "bun:test";\nimport * as sums from "../../src/sums";\nexport function row() { jest.spyOn(sums, "half").mockReturnValue(-3); }\n`,
    refusedSpy,
  ],
  [
    "vi.doMock()",
    `import { vi } from "bun:test";\nexport function row() { vi.doMock("../../src/sums", () => ({ half: () => -3 })); }\n`,
    refusedMock,
  ],
])("so does the refusal of %s in such a file", async (_, helper, refusal) => {
  const files = project(...notFollowed["that ends in a slash, with a name behind it"], helper);
  expect(await ran(files)).toEqual(asPlain);
  expect(await ran(files, "--aot")).toEqual({ seen: [], refused: [refusal], exitCode: 1 });
});
