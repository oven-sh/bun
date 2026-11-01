// A mock ends with its test file, and a user of the mocked file is linked to what stands when `bun test` would load it anew, however it reads the file. Pairs of
// test files in one realm, over the layers that the run takes by itself: the first file of a pair mocks, the next one mocks nothing and looks again. Compiled code
// runs no body again: the user is linked anew. What `bun test` prints is the specification.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// Twenty fillers import every mocked file and every user imports the fillers: so the plan lays the mocked files below their users, and from the second pair on
// a mocked file has run when it is mocked.
const fillers = 20;
const functionsOfFiller = Math.ceil(1_500_000 / fillers / 46);
const real = `export const flag = "real";\nexport const plain = "real";\n`;
const realOfFile = `exports.flag = "real";\nexports.plain = "real";\n`;
const one = `() => ({ flag: "one", plain: "one" })`;
const reads = (dep: string) =>
  `import { flag, plain } from "${dep}";\nimport * as ns from "${dep}";\nexport const report = () => [flag, plain, ns.flag].join();\n`;

// `first`: what the first file of the pair does. DEP and USER: the names as the pair spells them. look(): a line with what the user reports.
type Kind = { dep?: string; user?: string; name?: string; head?: string; looks?: string; first?: string };
const kinds: Record<string, Kind> = {
  "company": {},
  // The test files ask for the mocked file itself ahead of its user.
  "written": { looks: `(await import(DEP)).flag, (await import(USER)).report()` },
  "computed": { name: `(globalThis.whereSourcesLie ?? "./src") + "/computed/dep.js"` },
  // With its name in a constant the user is compiled beside the test files, where it names what it imports as its text does.
  // A user that a statement imported ahead of the mock keeps the file.
  "constants": {
    head: `import * as early from "./src/constants/early.js";\nconst NAME = "./src/constants/dep.js", LATE = "./src/constants/user.js";\n`,
    name: "NAME",
    looks: `(await import(LATE)).report(), early.report()`,
  },
  "star": {
    user: `export * from "./dep.js";\nimport * as own from "./user.js";\nexport const report = () => [own.flag, own.added, Object.keys(own).sort().join("+")].join();\n`,
    first: `vi.doMock(DEP, () => ({ flag: "one", plain: "one", added: "added" }));\n  await look("mocked");`,
  },
  "commonjs": { dep: "dep.cjs" },
  "package": { dep: "dep-of-package" },
  "the-mock-ends": {
    first: `vi.doMock(DEP, ${one});\n  await import(USER);\n  vi.doUnmock(DEP);\n  await look("behind the end");`,
  },
  "a-second-mock": {
    first: `vi.doMock(DEP, ${one});\n  await import(USER);\n  vi.doMock(DEP, () => ({ flag: "two", plain: "two" }));\n  await look("behind the second");`,
  },
  // The number says who asked the factory.
  "a-factory-that-fails": {
    dep: "dep.cjs",
    first: `let booms = 0;
  const tried = async read => { try { return await read(); } catch (e) { return "threw " + e.message; } };
  await import(USER);
  vi.doMock(DEP, () => { throw new Error("boom " + ++booms); });
  console.log("SEEN a-factory-that-fails mocked", await tried(async () => (await import(USER)).report()), await tried(async () => (await import(DEP)).flag));`,
  },
  // The second mock never comes to stand. The load that its factory ended is made anew under the third.
  "behind-a-failure": {
    dep: "dep.cjs",
    first: `const tried = async read => { try { return await read(); } catch (e) { return "threw " + e.message; } };
  vi.doMock(DEP, ${one});
  await import(USER);
  vi.doMock(DEP, async original => { await 0; throw new Error("tardy boom"); });
  console.log("SEEN behind-a-failure failed", await tried(async () => (await import(USER)).report()));
  vi.doMock(DEP, () => ({ flag: "three", plain: "three" }));
  await look("behind the third");`,
  },
};

test("a user above a mocked file reads what bun test would load it with", async () => {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "node_modules/dep-of-package/package.json": `{ "name": "dep-of-package", "type": "module", "main": "index.js" }`,
    "node_modules/dep-of-package/index.js": real,
  };
  const fill = Array.from({ length: fillers }, (_, n) => `import "../../fill/f${n}.js";\n`).join("");
  const order: string[] = [];
  let below = "";
  for (const [
    kind,
    { dep = "dep.js", user, name, head = "", looks = `(await import(USER)).report()`, first },
  ] of Object.entries(kinds)) {
    const isPackage = !dep.includes(".");
    if (!isPackage) files[`src/${kind}/${dep}`] = dep.endsWith(".cjs") ? realOfFile : real;
    files[`src/${kind}/user.js`] = fill + (user ?? reads(isPackage ? dep : `./${dep}`));
    files[`src/${kind}/early.js`] = fill + reads(isPackage ? dep : `./${dep}`);
    below += isPackage ? `import "${dep}";\n` : `import "../src/${kind}/${dep}";\n`;
    const spell = (text: string) =>
      text
        .replaceAll("DEP", name ?? (isPackage ? `"${dep}"` : `"./src/${kind}/${dep}"`))
        .replaceAll("USER", `"./src/${kind}/user.js"`);
    const top =
      `import { vi, test } from "bun:test";\n${head}` +
      `const look = async step => console.log("SEEN ${kind}", step, ${spell(looks)});\n`;
    files[`${kind}-1.test.js`] =
      `${top}test("mocks", async () => {\n  ${spell(first ?? `vi.doMock(DEP, ${one});\n  await look("mocked");`)}\n});\n`;
    files[`${kind}-2.test.js`] = `${top}test("mocks nothing", () => look("next"));\n`;
    order.push(`./${kind}-1.test.js`, `./${kind}-2.test.js`);
  }
  for (let n = 0; n < fillers; n++) {
    let text = below;
    for (let i = 0; i < functionsOfFiller; i++) text += `export function f${n}_${i}(x) { return x + ${i}; }\n`;
    files[`fill/f${n}.js`] = text;
  }
  using dir = tempDir("aot-mock-kinds-layers", files);
  // One realm for all the test files, in this order.
  const printed = async (...flags: string[]) => {
    const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags, ...order], String(dir), { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" }); // prettier-ignore
    return (stdout + "\n" + stderr).split("\n");
  };
  const seen = (lines: string[]) => lines.filter(line => /^SEEN |^\S+-[12]\.test\.js:$/.test(line));
  const plain = seen(await printed());
  expect(plain.filter(line => line.startsWith("SEEN "))).toEqual([
    "SEEN company mocked one,one,one",
    "SEEN company next real,real,real",
    "SEEN written mocked one one,one,one",
    "SEEN written next real real,real,real",
    "SEEN computed mocked one,one,one",
    "SEEN computed next real,real,real",
    "SEEN constants mocked one,one,one real,real,real",
    "SEEN constants next real,real,real real,real,real",
    "SEEN star mocked one,added,added+flag+plain+report",
    "SEEN star next real,,flag+plain+report",
    "SEEN commonjs mocked one,one,one",
    "SEEN commonjs next real,real,real",
    "SEEN package mocked one,one,one",
    "SEEN package next real,real,real",
    "SEEN the-mock-ends behind the end real,real,real",
    "SEEN the-mock-ends next real,real,real",
    "SEEN a-second-mock behind the second two,two,two",
    "SEEN a-second-mock next real,real,real",
    "SEEN a-factory-that-fails mocked threw boom 1 threw boom 2",
    "SEEN a-factory-that-fails next real,real,real",
    "SEEN behind-a-failure failed threw tardy boom",
    "SEEN behind-a-failure behind the third three,three,three",
    "SEEN behind-a-failure next real,real,real",
  ]);
  const layers = await printed("--aot", "--aot-memory-limit", "1MB");
  expectLayers(layers.join("\n"));
  expect(seen(layers)).toEqual(plain);
}, 270_000);
