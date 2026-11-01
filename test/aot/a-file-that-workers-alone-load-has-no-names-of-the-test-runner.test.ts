import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { runsWholeGrids, waysFor } from "./harness/ways";
import { test } from "./supported";

// `bun test` hands `expect`, `test`, `jest` and the like to every file that the thread of the tests loads. A Worker's thread gets none of them:
// there they are free names, `typeof expect` is "undefined" and `expect(1)` throws a ReferenceError.
const names = `[typeof expect, typeof jest, typeof test, typeof describe, typeof it, typeof beforeAll, typeof vi].join(" ")`;
const called = `(() => { try { expect(1); return "called"; } catch (error) { return error.constructor.name + ": " + error.message; } })()`;
const start = (id: string, file: string) => `
import { test } from "bun:test";
test("${id}", async () => {
  const worker = new Worker(new URL("${file}", import.meta.url));
  const said = await new Promise(resolve => { worker.onmessage = event => resolve(event.data); });
  console.log("${id}|", said);
  await worker.terminate();
});
`;

const projects: Record<string, Record<string, string>> = {
  "nothing but Workers loads the files": {
    "package.json": `{ "name": "p", "type": "module" }`,
    "c01/case.test.js": start("c01", "./started.js"),
    "c01/started.js": `postMessage(${names} + " | " + ${called});`,
    "c02/case.test.js": start("c02", "./started.js"),
    "c02/started.js": `import { seen } from "./imported.js";\npostMessage(seen());`,
    "c02/imported.js": `export const seen = () => ${names} + " | " + ${called};`,
    "c03/case.test.js": start("c03", "./started.cjs"),
    "c03/started.cjs": `postMessage(require("./required.cjs").seen());`,
    "c03/required.cjs": `exports.seen = () => ${names} + " | " + ${called};`,
    "c04/case.test.ts": start("c04", "./started.ts"),
    "c04/started.ts": `declare var self: Worker;\nconst all: string = ${names};\nself.postMessage(all);`,
    // The Worker's own global of that name is what the free name finds.
    "c05/case.test.js": start("c05", "./started.js"),
    "c05/started.js": `globalThis.expect = value => "mine " + value;\npostMessage(typeof expect + " " + expect(1));`,
    // The thread of the tests still has them, without an import.
    "c06/case.test.js": `test("c06", () => { console.log("c06|", ${names}); expect(1).toBe(1); });`,
  },
  // The build cannot tell that no test loads the file, so the file keeps the names: a test that works goes on working.
  "a test loads the file under a name that nobody reads": {
    "package.json": `{ "name": "p", "type": "module" }`,
    "c01/case.test.js": `
      import { test } from "bun:test";
      test("c01", async () => {
        const worker = new Worker(new URL("./both.js", import.meta.url));
        await new Promise(resolve => { worker.onmessage = resolve; });
        await worker.terminate();
        const both = await import(Buffer.from("Li9ib3RoLmpz", "base64").toString());
        console.log("c01|", both.seen());
      });`,
    "c01/both.js": `export const seen = () => ${names};\nif (!Bun.isMainThread) postMessage("started");`,
  },
};

const runs = new Map<string, Promise<Map<string, string[]>>>();
function ran(project: string, flags: string[], words = "") {
  return runs.getOrInsertComputed(JSON.stringify([project, flags, words]), async () => {
    using dir = tempDir("names-of-the-test-runner", projects[project]);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    const printed = new Map<string, string[]>();
    for (const [, id, line] of stdout.matchAll(/^(c\d+)\| (.*)$/gm))
      printed.getOrInsertComputed(id, () => []).push(line);
    return printed;
  });
}

const everyWay: [string[], string][] = [
  [[], ""],
  [["--isolate"], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
  [["--isolate"], "TestRunLayers:3,TestRunPartFiles:1"],
];
// No case is about the layers. On a build that gives the names by the file and asks no realm, c01 to c05 of the first project fail in each of the four ways alike: that project is
// the witness, and two layers stand for three. The second project passes there in every way, so nothing says which of its ways sees the most.
const ways = runsWholeGrids ? everyWay : everyWay.slice(0, 3);
const witness = "nothing but Workers loads the files";

for (const [project, files] of Object.entries(projects)) {
  for (const [flags, words] of waysFor(ways, project === witness)) {
    const ids = [...new Set(Object.keys(files).flatMap(path => path.match(/^c\d+/) ?? []))];
    test.each(ids)(
      `${project}, %s: ${JSON.stringify(flags)} ${words}`,
      async id => {
        const plain = (await ran(project, flags)).get(id);
        expect(plain).toHaveLength(1);
        expect((await ran(project, ["--aot", ...flags], words)).get(id)).toEqual(plain);
      },
      480_000,
    );
  }
}
