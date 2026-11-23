// Vitest leaves packages as they are: a package that loads another package gets the original of what `vi.mock()` mocked, and the files of the project get the mock.
// Jest's mocks reach packages too. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const commonJS = {
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/dep/index.js": `exports.value = () => "real";\n`,
  "node_modules/reads/package.json": `{ "name": "reads", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/reads/index.js": `const dep = require("dep");\nexports.seen = () => dep.value();\n`,
};
const modules = {
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js", "type": "module" }`,
  "node_modules/dep/index.js": `export const value = () => "real";\n`,
  "node_modules/reads/package.json": `{ "name": "reads", "version": "1.0.0", "main": "index.js", "type": "module" }`,
  "node_modules/reads/index.js": `import { value } from "dep";\nexport const seen = () => value();\n`,
};
const factory = `() => ({ value: () => "mocked" })`;
// The original loads a file that asks for it again while its body runs.
const ring = {
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/reads/package.json": `{ "name": "reads", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/reads/index.js": `const dep = require("dep");\nexports.seen = () => dep.value() + " | " + dep.atLoad + " | " + dep.later();\n`,
};
const original = (other: string) =>
  `exports.early = "real-early";\nconst other = require("${other}");\nexports.value = () => "real";\nexports.atLoad = other.atLoad;\nexports.later = () => other.later();\n`;
const asksBack = (name: string) =>
  `const it = require("${name}");\nexports.atLoad = it.early + "," + typeof it.value;\nexports.later = () => it.value();\n`;
const wholeFactory = `() => ({ value: () => "mocked", early: "mocked-early", atLoad: "of-mock", later: () => "of-mock" })`;
const ringTest = (mocked: string) =>
  `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nvi.mock("${mocked}", ${wholeFactory});\ntest("t", () => console.log("SAID " + seen()));\n`;

// TODO(bun): `differs`: a compiled CommonJS file has one variable for its exports. While the original's body runs it holds the original, also for a file of the project, which gets the mock in `bun test`.
const cases: Record<string, { files: Record<string, string>; said: string[]; differs?: boolean }> = {
  "a package requires a package": {
    files: {
      ...commonJS,
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nvi.mock("dep", ${factory});\ntest("t", () => console.log("SAID " + seen()));\n`,
    },
    said: ["SAID real"],
  },
  "the package is loaded behind the mock": {
    files: {
      ...commonJS,
      "a.test.js": `import { test, vi } from "bun:test";\nvi.mock("dep", ${factory});\ntest("t", async () => console.log("SAID " + (await import("reads")).seen()));\n`,
    },
    said: ["SAID real"],
  },
  "a file of the project beside it gets the mock": {
    files: {
      ...commonJS,
      "own.cjs": `exports.seen = () => require("dep").value();\n`,
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nimport own from "./own.cjs";\nvi.mock("dep", ${factory});\ntest("t", () => console.log("SAID " + own.seen() + " " + seen() + " " + own.seen()));\n`,
    },
    said: ["SAID mocked real mocked"],
  },
  "jest.mock() reaches the package": {
    files: {
      ...commonJS,
      "a.test.js": `import { test, jest } from "bun:test";\nimport { seen } from "reads";\njest.mock("dep", ${factory});\ntest("t", () => console.log("SAID " + seen()));\n`,
    },
    said: ["SAID mocked"],
  },
  "a package imports a package": {
    files: {
      ...modules,
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nvi.mock("dep", ${factory});\ntest("t", () => console.log("SAID " + seen()));\n`,
    },
    said: ["SAID real"],
  },
  "a ring of files inside the mocked package": {
    files: {
      ...ring,
      "node_modules/dep/index.js": original("./b.js"),
      "node_modules/dep/b.js": asksBack("./index.js"),
      "a.test.js": ringTest("dep"),
    },
    said: ["SAID real | real-early,undefined | real"],
  },
  "a file of the project that the original loads asks for it": {
    files: {
      ...ring,
      "node_modules/dep/index.js": original("../../own.cjs"),
      "own.cjs": asksBack("dep"),
      "a.test.js": ringTest("dep"),
    },
    said: ["SAID real | mocked-early,function | mocked"],
    differs: true,
  },
  "a function of the project that the original calls asks for it": {
    files: {
      ...ring,
      "node_modules/dep/index.js": `exports.early = "real-early";\nconst own = require("../../own.cjs");\nexports.atLoad = own.ask();\nexports.value = () => "real";\nexports.later = () => own.ask();\n`,
      "own.cjs": `exports.ask = () => {\n  const dep = require("dep");\n  return dep.early + "," + typeof dep.value;\n};\n`,
      "a.test.js": `import { test, vi } from "bun:test";\nimport own from "./own.cjs";\nimport { seen } from "reads";\nvi.mock("dep", ${wholeFactory});\ntest("t", () => console.log("SAID " + seen() + " | " + own.ask()));\n`,
    },
    said: ["SAID real | mocked-early,function | mocked-early,function | mocked-early,function"],
    differs: true,
  },
  "the mocked file and its ring lie in the project": {
    files: {
      "node_modules/reads/package.json": ring["node_modules/reads/package.json"],
      "node_modules/reads/index.js": `const a = require("../../a.cjs");\nexports.seen = () => a.value() + " | " + a.atLoad + " | " + a.later();\n`,
      "a.cjs": original("./b.cjs"),
      "b.cjs": asksBack("./a.cjs"),
      "a.test.js": ringTest("./a.cjs"),
    },
    said: ["SAID real | mocked-early,function | mocked"],
    differs: true,
  },
};

for (const [name, { files, said, differs }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("aot-mock-package-original", { "package.json": `{ "type": "module" }`, ...files });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const lines = (stdout + "\n" + stderr).split("\n");
      return { said: lines.filter(line => line.startsWith("SAID ") || /^error|Error: /.test(line)), exitCode };
    };
    const plain = await seenWith();
    expect(plain).toEqual({ said, exitCode: 0 });
    if (differs) expect(await seenWith("--aot")).not.toEqual(plain);
    else expect(await seenWith("--aot")).toEqual(plain);
  });
}
