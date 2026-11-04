import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `import(`./lib.ts?t=${Math.random()}`)`: bun test makes one more module of THAT file, and what the file imports stays as it was loaded.
// The path is spelled whatever the query turns out to be, so the build knows which file is read once more, and has read what the copy imports.
// Such a place used to make every file of the run one that may load again: then no module is compiled as in the executable.
// Where the build has not read the file, or cannot read the path, every file may still load again: the two shapes listed in `everyFileStill`.
// Each shape is a project of its own: beside others a fault can hide.
const everyFileStill = ["nobody-else-imports-the-file", "the-path-is-computed-too"];

const shapes: Record<string, Record<string, string>> = {
  "a-helper-in-another-folder-loads-it": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
import { fresh } from "./helpers/fresh";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  const copy = await fresh(1);
  say("copy", copy.tick(), copy.seen(), copy.tick === first.tick);
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "helpers/fresh.ts": `export const fresh = (n: number) => import(\`../lib.js?fresh=\${n}\`);
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-query-that-is-computed-behind-a-spelled-path": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-query-that-is-spelled": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import("./lib.ts?again"); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "it-imports-a-commonjs-file": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.cjs": `let count = 0;
exports.bump = () => ++count;
exports.read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep.cjs";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "it-imports-the-library": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { basename } from "node:path";
import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read(), basename("/a/b.c")];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "it-imports-through-a-barrel": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "barrel.ts": `export * from "./dep";
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./barrel";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "it-is-a-commonjs-file": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib.cjs";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.cjs?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.cjs": `let count = 0;
exports.bump = () => ++count;
exports.read = () => count;
console.log("SEEN dep runs");
`,
    "lib.cjs": `const { bump, read } = require("./dep.cjs");
let own = 0;
exports.tick = () => [++own, bump()];
exports.seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "nobody-else-imports-the-file": {
    "a.test.ts": `import { test } from "bun:test";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen()); }
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen()); }
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-copy-is-spied-on": {
    "a.test.ts": `import { test } from "bun:test";
import { spyOn } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
  const copy = await import(\`./lib.ts?t=\${Math.random()}\`);
  const spy = spyOn(copy, "tick").mockReturnValue([0, 0]);
  say("spied", copy.tick(), first.tick());
  spy.mockRestore();
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-file-lies-on-a-cycle": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `import { tick } from "./lib";
let count = 0;
export const bump = () => ++count;
export const read = () => count;
export const back = () => typeof tick;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-path-has-no-extension": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-path-is-computed-too": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./\${process.env.NOBODY_SETS_THIS ?? "lib"}.ts?t=1\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-path-names-a-folder": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./folder";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./folder?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "folder/index.ts": `import { bump, read } from "../dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-path-says-js-and-the-file-is-ts": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.js?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "the-same-query-twice-is-one-module": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import("./lib.ts?one"); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  { const copy = await import("./lib.ts?one"); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  { const copy = await import("./lib.ts?two"); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "two-test-files": {
    "a.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "b.test.ts": `import { test } from "bun:test";
import * as first from "./lib";
test("b", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say("first", first.tick(), first.seen());
  { const copy = await import(\`./lib.ts?t=\${Math.random()}\`); say("copy", copy.tick(), copy.seen(), copy.tick === first.tick); }
  say("first again", first.tick(), first.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "what-it-imports-is-mocked": {
    "a.test.ts": `import { mock, test } from "bun:test";
mock.module("./dep", () => ({ bump: () => -1, read: () => -2 }));
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = await import("./lib");
  say("first", first.tick(), first.seen());
  const copy = await import(\`./lib.ts?t=\${Math.random()}\`);
  say("copy", copy.tick(), copy.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(`a file loaded under a query: ${name}`, async () => {
    using dir = tempDir("aot-loaded-under-a-query", files);
    const seenWith = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      return {
        seen: {
          lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
          exitCode,
        },
        everyFile: (stdout + stderr).includes("every file may load again"),
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.seen.lines.length).toBeGreaterThan(2);
    expect(plain.seen.exitCode).toBe(0);
    expect(compiled.seen).toEqual(plain.seen);
    expect(compiled.everyFile).toBe(everyFileStill.includes(name));
  }, 120_000);
}
