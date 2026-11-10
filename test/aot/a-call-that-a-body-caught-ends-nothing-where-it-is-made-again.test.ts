import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` runs a file that laid mocks again for the next test file that imports it. A compiled body runs once, and its calls are made again.
const testFile = (name: string) => `import { test } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
test("${name}", async () => {
  say("file", "${name}");
  await tell("setup", async () => { await import("./setup.mjs"); return "loaded"; });
  await tell("lamp", async () => (await import("./lamp.mjs")).word);
  await tell("desk", async () => (await import("./desk.mjs")).word);
  await tell("rug", async () => (await import("./rug.mjs")).word);
});
`;

const projectOf = (setup: string) => ({
  "package.json": `{ "name": "made-up", "private": true }\n`,
  "lamp.mjs": `export const word = "own lamp";\n`,
  "desk.mjs": `export const word = "own desk";\n`,
  "rug.mjs": `export const word = "own rug";\n`,
  "setup.mjs": `import { mock } from "bun:test";\nimport "./lamp.mjs";\n${setup}`,
  "a_test.js": testFile("one"),
  "b_test.js": testFile("two"),
});

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-call-that-a-body-caught", project);
  const { stdout } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

test.failing(
  "a mock is laid in front of a call whose throw the body does not catch: it prints what bun test prints: a wrong answer today: under `bun test --aot` the second test file reads the file's own word, where `bun test` reads the mock's",
  async () => {
    const project = projectOf(`mock.module("./rug.mjs", () => ({ word: "stand-in rug" }));
mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); });
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
`);
    const plain = await linesOf(project);
    expect(plain.filter(line => line.startsWith("SAID rug"))).toEqual([
      `SAID rug "stand-in rug"`,
      `SAID rug "stand-in rug"`,
    ]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);

test.failing(
  "a factory throws from the second time on, and the body would catch it: it prints what bun test prints: a wrong answer today: under `bun test --aot` the import in the second test file is rejected and the mock behind it is not laid",
  async () => {
    const project = projectOf(`try {
  mock.module("./lamp.mjs", () => {
    globalThis.asked = (globalThis.asked ?? 0) + 1;
    if (globalThis.asked > 1) throw new Error("the factory throws");
    return { word: "stand-in lamp" };
  });
} catch (error) {}
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
`);
    const plain = await linesOf(project);
    expect(plain.filter(line => line.startsWith("SAID setup"))).toEqual([`SAID setup "loaded"`, `SAID setup "loaded"`]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);
