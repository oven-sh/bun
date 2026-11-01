import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// The runs take a debug build four to six minutes: more than the runner gives a case of a build with a sanitizer.
raiseDefaultTimeout(isDebug ? 600_000 : 120_000);

// A build is what costs, and a run in layers builds Bun's own code whatever the project holds. So the cases are the folders of one
// project, which is run once in each form. Each folder has helpers of its own, which only its own test files import, as in a
// project of its own.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "resolveJsonModule": true } }`,
};
const folders: string[] = [];

async function seen(words?: string, ...flags: string[]) {
  using dir = tempDir("an-import-takes-a-file-for-something-else", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  if (exitCode !== 0) console.error(stderr);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return {
    form: [...flags, words].filter(Boolean).join(" ") || "plain",
    // The parts of a run end in any order.
    printed: stdout.split("\n").sort(),
    results: results.sort(),
    exitCode,
  };
}

// Plain `bun test` first. The four run at once, each in a copy of the project, and a test goes on when all four have ended: a run
// that throws leaves no other running behind the report of the file.
let runs: Promise<Awaited<ReturnType<typeof seen>>[]> | undefined;
const ran = () =>
  (runs ??= Promise.allSettled([
    seen(),
    seen(undefined, "--aot"),
    seen("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seen("TestRunLayers:1,TestRunPartFiles:1", "--aot"),
  ]).then(all =>
    all.map(each => {
      if (each.status === "rejected") throw each.reason;
      return each.value;
    }),
  ));

/** `asked`: what the test file prints behind "asked" under plain `bun test`. */
function runsAsPlain(title: string, parts: (name: string) => { asked: string; testFile: string }) {
  const name = `c${folders.length + 1}`;
  folders.push(name);
  const { asked, testFile } = parts(name);
  Object.assign(files, {
    // A helper says which folder it lies in: an answer out of another folder's file of the same name prints another line.
    [`${name}/helpers/named.js`]: `export const name = "named in ${name}";`,
    [`${name}/helpers/bundle.js`]: `export default function start() { return "ran in ${name}"; }`,
    [`${name}/helpers/data.json`]: `{ "name": "data in ${name}" }`,
    // It imports the helpers as code, so the layer that the test files share holds them as code.
    [`${name}/shared.test.js`]: `
    import { test } from "bun:test";
    import "./helpers/named.js";
    import start from "./helpers/bundle.js";
    import data from "./helpers/data.json";
    test("${name} shared", () => { console.log("${name}", start(), data.name); });`,
    [`${name}/third.test.js`]: `import { test } from "bun:test";\ntest("${name} third", () => {});`,
    [`${name}/asks.test.js`]: testFile,
  });
  test(title, async () => {
    const [plain, ...compiled] = (await ran()).map(({ form, printed, results }) => ({
      form,
      printed: printed.filter(line => line.startsWith(`${name} `)),
      results: results.filter(result => result.split(" ")[1] === name),
    }));
    expect(plain).toEqual({
      form: "plain",
      printed: [`${name} asked ${asked}`, `${name} ran in ${name} data in ${name}`],
      results: [`pass ${name} asks`, `pass ${name} shared`, `pass ${name} third`],
    });
    for (const each of compiled) expect(each).toEqual({ ...plain, form: each.form });
  });
}

runsAsPlain("the text of a file without a default export", name => ({
  asked: `string export const name = "named in ${name}";`,
  testFile: `
    import { test } from "bun:test";
    import text from "./helpers/named.js" with { type: "text" };
    test("${name} asks", () => { console.log("${name} asked", typeof text, text); });`,
}));

runsAsPlain("the text of a file whose default export is a function", name => ({
  asked: `string true export default function start() { return "ran in ${name}"; }`,
  testFile: `
    import { test } from "bun:test";
    import text from "./helpers/bundle.js" with { type: "text" };
    test("${name} asks", () => { console.log("${name} asked", typeof text, text.startsWith("export default"), text); });`,
}));

runsAsPlain("the path of a file", name => ({
  asked: "string true",
  testFile: `
    import { test } from "bun:test";
    import path from "./helpers/bundle.js" with { type: "file" };
    test("${name} asks", () => {
      console.log("${name} asked", typeof path, String(path).replaceAll("\\\\", "/").endsWith("${name}/helpers/bundle.js"));
    });`,
}));

runsAsPlain("the code and the text of one file", name => ({
  asked: `ran in ${name} string true export default function start() { return "ran in ${name}"; }`,
  testFile: `
    import { test } from "bun:test";
    import start from "./helpers/bundle.js";
    import text from "./helpers/bundle.js" with { type: "text" };
    test("${name} asks", async () => {
      const again = await import("./helpers/bundle.js", { with: { type: "text" } });
      console.log("${name} asked", start(), typeof text, again.default === text, text);
    });`,
}));

runsAsPlain("a file taken for what its name says is the module of the layer", name => ({
  asked: `data in ${name} false string`,
  testFile: `
    import { test } from "bun:test";
    import data from "./helpers/data.json" with { type: "json" };
    import plainly from "./helpers/data.json";
    import text from "./helpers/data.json" with { type: "text" };
    test("${name} asks", () => { console.log("${name} asked", data.name, data === plainly, typeof text); });`,
}));

// The case above asks for the type of the text alone. This one reads the text.
runsAsPlain("the text of a data file", name => ({
  asked: `string { "name": "data in ${name}" }`,
  testFile: `
    import { test } from "bun:test";
    import text from "./helpers/data.json" with { type: "text" };
    test("${name} asks", () => { console.log("${name} asked", typeof text, text); });`,
}));

// What no folder answers for alone: nothing else runs or prints, and the run ends with 0.
test("the run of all the folders ends as under plain bun test", async () => {
  const [plain, ...compiled] = (await ran()).map(({ form, printed, results, exitCode }) => ({
    form,
    printed: printed.filter(line => !folders.includes(line.split(" ")[0])),
    results: results.filter(result => !folders.includes(result.split(" ")[1])),
    exitCode,
  }));
  expect(plain).toEqual({
    form: "plain",
    printed: ["", expect.stringMatching(/^bun test v/)],
    results: [],
    exitCode: 0,
  });
  for (const each of compiled) expect(each).toEqual({ ...plain, form: each.form });
});
