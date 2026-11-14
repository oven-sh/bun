import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` hands `expect`, `test`, `jest` and the like to every file that the thread of the tests loads. A Worker's thread gets none of them:
// there they are free names, `typeof expect` is "undefined" and `expect(1)` throws a ReferenceError.
// A project of its own: Workers change what a build may assume of the whole program, so beside other cases this one silences them.
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

const files = {
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
};

const runs = new Map<string, Promise<Map<string, string[]>>>();
function ran(...flags: string[]) {
  return runs.getOrInsertComputed(flags.join(), async () => {
    using dir = tempDir("names-of-the-test-runner", files);
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    if (exitCode !== 0) console.error(stderr);
    const printed = new Map<string, string[]>();
    for (const [, id, line] of stdout.matchAll(/^(c\d+)\| (.*)$/gm))
      printed.getOrInsertComputed(id, () => []).push(line);
    return printed;
  });
}

test.each(["c01", "c02", "c03", "c04", "c05"])(
  "nothing but Workers loads the files, %s",
  async id => {
    const plain = (await ran()).get(id);
    expect(plain).toHaveLength(1);
    expect((await ran("--aot")).get(id)).toEqual(plain);
  },
  480_000,
);
