import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const moduleCount = 1000;
const indexes = Array.from({ length: moduleCount }, (_, index) => index);

function createSimpleGraph() {
  const files: Record<string, string> = {
    "log.mjs": `export let orderSum = 0;\nlet position = 0;\nexport function record(id) { orderSum += ++position * id; }\n`,
    "fan.mjs": indexes.map(index => `import "./fan-${index}.mjs";\n`).join(""),
    "main.mjs": `
      import { heapStats } from "bun:jsc";
      import { orderSum } from "./log.mjs";
      import "./chain-0.mjs";
      import "./fan.mjs";
      console.log(orderSum);
      console.log((heapStats().objectTypeCounts.AOTModuleRecord ?? 0) <= 1);
    `,
  };
  for (const index of indexes) {
    const next = index + 1 < moduleCount ? `import "./chain-${index + 1}.mjs";\n` : "";
    files[`chain-${index}.mjs`] = `import { record } from "./log.mjs";\n${next}record(${index});\n`;
    files[`fan-${index}.mjs`] = `import { record } from "./log.mjs";\nrecord(${moduleCount + index});\n`;
  }
  return files;
}

function computeOrderSum() {
  const chain = indexes.toReversed();
  const fan = indexes.map(index => moduleCount + index);
  return [...chain, ...fan].reduce((sum, id, position) => sum + (position + 1) * id, 0);
}

const failureDepth = 100;
const throwingIndex = 50;

function createFailingGraph() {
  const files: Record<string, string> = {
    "log.mjs": `export const bodies = [];\n`,
    "main.mjs": `
      import { bodies } from "./log.mjs";
      const caught = imported => imported.then(() => "fulfilled", error => error);
      const first = await caught(import("./chain-0.mjs"));
      const bodiesAfterFirst = bodies.length;
      console.log(first.message);
      console.log("second import", (await caught(import("./chain-0.mjs"))) === first);
      console.log("above", (await caught(import("./chain-${throwingIndex - 1}.mjs"))) === first);
      console.log("thrower", (await caught(import("./chain-${throwingIndex}.mjs"))) === first);
      console.log("below", await caught(import("./chain-${throwingIndex + 1}.mjs")));
      console.log("sibling", await caught(import("./sibling-0.mjs")));
      console.log("bodies", bodiesAfterFirst, bodies.length);
    `,
  };
  for (let index = 0; index < failureDepth; index++) {
    const next = index + 1 < failureDepth ? `import "./chain-${index + 1}.mjs";\n` : "";
    const body = index === throwingIndex ? `throw new Error("thrown by chain-${index}");\n` : "";
    files[`chain-${index}.mjs`] =
      `import { bodies } from "./log.mjs";\nimport "./sibling-${index}.mjs";\n${next}bodies.push("chain-${index}");\n${body}`;
    files[`sibling-${index}.mjs`] = `import { bodies } from "./log.mjs";\nbodies.push("sibling-${index}");\n`;
  }
  return files;
}

function createFailingCycle() {
  return {
    "log.mjs": `export const bodies = [];\n`,
    "cycle-a.mjs": `import { bodies } from "./log.mjs";\nimport "./cycle-b.mjs";\nbodies.push("cycle-a");\nthrow new Error("thrown by cycle-a");\n`,
    "cycle-b.mjs": `import { bodies } from "./log.mjs";\nimport "./cycle-a.mjs";\nbodies.push("cycle-b");\n`,
    "main.mjs": `
      import { bodies } from "./log.mjs";
      const caught = imported => imported.then(() => "fulfilled", error => error);
      const first = await caught(import("./cycle-a.mjs"));
      console.log(first.message);
      console.log("other member", (await caught(import("./cycle-b.mjs"))) === first);
      console.log("bodies", bodies.join());
    `,
  };
}

async function compileAndRun(folder: string) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  const build = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], folder);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return run([executable], folder);
}

test.concurrent(
  "a deep chain and a wide fan of synchronous modules run in order without module records",
  async () => {
    using dir = tempDir("aot-many-simple-modules", createSimpleGraph());
    const folder = String(dir);
    const plain = await run([bunExe(), "run", "./main.mjs"], folder);
    expect(plain).toEqual({ stdout: `${computeOrderSum()}\ntrue\n`, stderr: "", exitCode: 0 });
    expect(await compileAndRun(folder)).toEqual(plain);
  },
  600_000,
);

test.concurrent(
  "a module that throws fails everything above it, once, with one error object",
  async () => {
    using dir = tempDir("aot-many-simple-modules-failure", createFailingGraph());
    const folder = String(dir);
    const plain = await run([bunExe(), "run", "./main.mjs"], folder);
    const bodies = failureDepth + failureDepth - throwingIndex;
    expect(plain).toEqual({
      stdout: [
        `thrown by chain-${throwingIndex}`,
        "second import true",
        "above true",
        "thrower true",
        "below fulfilled",
        "sibling fulfilled",
        `bodies ${bodies} ${bodies}`,
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(await compileAndRun(folder)).toEqual(plain);
  },
  600_000,
);

test.concurrent(
  "a module of a synchronous cycle that throws fails the other member",
  async () => {
    using dir = tempDir("aot-many-simple-modules-cycle", createFailingCycle());
    const folder = String(dir);
    const plain = await run([bunExe(), "run", "./main.mjs"], folder);
    expect(plain).toEqual({
      stdout: "thrown by cycle-a\nother member true\nbodies cycle-b,cycle-a\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await compileAndRun(folder)).toEqual(plain);
  },
  600_000,
);
