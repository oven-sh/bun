import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// The factories that one load calls run one at a time, in the order in which the load comes to their modules. What `bun test` prints is the specification.
const leaf = (name: string) => `console.log("| ${name} runs");\nexport const ${name} = "real ${name}";\n`;
const importer = (name: string, imports: string[]) =>
  imports.map(it => `import { ${it} } from "./${it}.js";\n`).join("") +
  `console.log("| ${name} runs");\nexport const ${name} = "(" + [${imports.join(", ")}].join(" ") + ")";\n`;
const head = `import { test, vi } from "bun:test";\nconst say = (...all) => console.log("|", ...all);\nconst later = ms => new Promise(done => setTimeout(done, ms));\n`;
const slow = (name: string, ms: number) =>
  `async () => { console.log("| ${name}'s factory begins"); await new Promise(done => setTimeout(done, ${ms})); console.log("| ${name}'s factory ends"); return { ${name}: "mock ${name}" }; }`;
const tick = (name: string) =>
  `async () => { console.log("| ${name}'s factory begins"); await null; console.log("| ${name}'s factory ends"); return { ${name}: "mock ${name}" }; }`;
const quick = (name: string) =>
  `() => { console.log("| ${name}'s factory runs"); return { ${name}: "mock ${name}" }; }`;
const fails = (name: string, ms: number) =>
  `async () => { console.log("| ${name}'s factory begins"); await new Promise(done => setTimeout(done, ${ms})); throw new Error("no ${name}"); }`;
const called = (factories: Record<string, string>) =>
  head +
  `test("t", async () => {\n` +
  Object.entries(factories)
    .map(([name, factory]) => `  vi.doMock("./${name}.js", ${factory});\n`)
    .join("") +
  `  try { say((await import("./a.js")).a); } catch (error) { say("a failed", error.message); }\n  await later(60);\n});\n`;
const hoisted = (factories: Record<string, string>) =>
  head +
  Object.entries(factories)
    .map(([name, factory]) => `vi.mock("./${name}.js", ${factory});\n`)
    .join("") +
  `import { a } from "./a.js";\ntest("t", () => say(a));\n`;

const projects: Record<string, [Record<string, string[]>, string]> = {
  "two that wait for timers": [{ a: ["k", "m"] }, called({ k: slow("k", 40), m: slow("m", 5) })],
  "three that wait for timers": [
    { a: ["k", "m", "n"] },
    called({ k: slow("k", 40), m: slow("m", 20), n: slow("n", 5) }),
  ],
  "two that wait for a job": [{ a: ["k", "m"] }, called({ k: tick("k"), m: tick("m") })],
  "one that answers at once between two that wait": [
    { a: ["k", "m", "n"] },
    called({ k: slow("k", 30), m: quick("m"), n: slow("n", 5) }),
  ],
  "one that waits between two that answer at once": [
    { a: ["k", "m", "n"] },
    called({ k: quick("k"), m: slow("m", 20), n: quick("n") }),
  ],
  "the first lies deeper": [{ a: ["b", "m"], b: ["k"] }, called({ k: slow("k", 30), m: slow("m", 5) })],
  "the second lies deeper": [{ a: ["k", "b"], b: ["m"] }, called({ k: slow("k", 30), m: slow("m", 5) })],
  "the second fails": [{ a: ["k", "m"] }, called({ k: slow("k", 30), m: fails("m", 5) })],
  "below a statement of the test file": [{ a: ["k", "m"] }, hoisted({ k: slow("k", 30), m: slow("m", 5) })],
};

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  return { printed: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| ")), exitCode };
}

const witnessOverLayers = "one that waits between two that answer at once";

for (const [name, [importers, testFile]] of Object.entries(projects)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("aot-factory-turns", {
        "package.json": `{ "name": "p", "type": "module" }`,
        ...Object.fromEntries(["k", "m", "n"].map(it => [`${it}.js`, leaf(it)])),
        ...Object.fromEntries(Object.entries(importers).map(([it, imports]) => [`${it}.js`, importer(it, imports)])),
        "a.test.js": testFile,
        // The next test file mocks nothing and reads everything.
        "z.test.js": `import { test } from "bun:test";\nimport { k } from "./k.js";\nimport { m } from "./m.js";\nimport { n } from "./n.js";\ntest("z", () => console.log("| z", k, m, n));\n`,
      });
      const plain = await report(String(dir), []);
      expect(plain.printed.length).toBeGreaterThan(3);
      expect(await report(String(dir), ["--aot"], "TestRunLayers:0")).toEqual(plain);
      if (!runsWholeGrids && name !== witnessOverLayers) return;
      expect(await report(String(dir), ["--aot"], "TestRunLayers:2")).toEqual(plain);
      expect(await report(String(dir), ["--aot", "--no-isolate"], "TestRunLayers:2")).toEqual(
        await report(String(dir), ["--no-isolate"]),
      );
    },
    240_000,
  );
}
