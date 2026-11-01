// Over the layers that a run takes by itself a mocked file may lie in a lower image than its users. Each of them sees the mock by when it was linked,
// as in one program: the users of an image had one module between them for the file, and all of them read what the last one linked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// Twenty fillers import every mocked file and every user imports the fillers: so the plan lays the mocked files below their users.
// Another test file imports the users too: so they lie in a layer that test files share, whose build sees no call of a mock.
const fillers = 20;
const functionsOfFiller = Math.ceil(1_500_000 / fillers / 46);
const user =
  Array.from({ length: fillers }, (_, n) => `import "../../fill/f${n}.js";\n`).join("") +
  `import { flag, plain } from "./dep.js";
import * as ns from "./dep.js";
export const values = () => [flag, plain, ns.flag].join();
export const held = () => ns;
`;

const cases: Record<string, string> = {
  "a-later-user-loads": `  say("before", early.values());
  const late = await import(LATE);
  say("early", early.values(), "late", late.values(), "one object", early.held() === late.held());`,
  "the-mock-ends": `  const late = await import(LATE);
  vi.doUnmock(DEP);
  say("early", early.values(), "the later user, held", late.values());`,
  "a-second-mock": `  const late = await import(LATE);
  vi.doMock(DEP, () => ({ flag: "two", plain: "two" }));
  say("early", early.values(), "the later user, held", late.values());`,
};

test("a user that was linked before a mock keeps the file, whoever of its image is linked later", async () => {
  const files: Record<string, string> = { "package.json": `{ "type": "module" }` };
  for (const [name, body] of Object.entries(cases)) {
    files[`src/${name}/dep.js`] = `export const flag = "real";\nexport const plain = "real";\n`;
    files[`src/${name}/early.js`] = user;
    files[`src/${name}/late.js`] = user;
    files[`test/${name}.test.js`] = `import { test, vi } from "bun:test";
import * as early from "../src/${name}/early.js";
const DEP = "../src/${name}/dep.js", LATE = "../src/${name}/late.js";
const say = (...all) => console.log("SEEN ${name}", ...all);
test("t", async () => {
  vi.doMock(DEP, () => ({ flag: "one", plain: "one" }));
${body}
});
`;
  }
  const users = Object.keys(cases).map(name => `import "../src/${name}/early.js";\nimport "../src/${name}/late.js";\n`).join(""); // prettier-ignore
  files["test/z.test.js"] = `import { test } from "bun:test";\n${users}test("another test file", () => {});\n`;
  const below = Object.keys(cases).map(name => `import "../src/${name}/dep.js";\n`).join(""); // prettier-ignore
  for (let n = 0; n < fillers; n++) {
    let text = below;
    for (let i = 0; i < functionsOfFiller; i++) text += `export function f${n}_${i}(x) { return x + ${i}; }\n`;
    files[`fill/f${n}.js`] = text;
  }
  using dir = tempDir("aot-mock-views-layers", files);
  const printed = async (...flags: string[]) => {
    const { stdout, stderr } = await run([bunExe(), "test", "--parallel=2", ...flags, "./test"], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" }); // prettier-ignore
    return (stdout + "\n" + stderr).split("\n");
  };
  const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN ")).sort();
  const plain = seen(await printed());
  expect(plain).toEqual([
    "SEEN a-later-user-loads before real,real,real",
    "SEEN a-later-user-loads early real,real,real late one,one,one one object false",
    "SEEN a-second-mock early real,real,real the later user, held one,one,one",
    "SEEN the-mock-ends early real,real,real the later user, held one,one,one",
  ]);
  const layers = await printed("--aot", "--aot-memory-limit", "1MB");
  expectLayers(layers.join("\n"));
  expect(seen(layers)).toEqual(plain);
}, 270_000);
