import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// "Every file may load again" was two claims in one: a file that has run may be TAKEN OUT of the table of loaded modules (a key that nobody reads, the table handed on,
// resetModules), or a text that nobody has read may come IN (Bun.plugin, a loader stored for a kind of file, a path that nobody reads under a query).
// Only the first lets anything load once more, so only there is every file of the run one whose body may run again, which is compiled otherwise than in an executable:
// test_run_loads/tests.rs text_that_comes_in_lets_no_body_run_again() holds the marks. Here each shape is a project of its own, held against plain `bun test`.
const shapes: Record<string, Record<string, string>> = {
  "TAKEN-OUT-a-key-that-nobody-reads": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  for (const key of Object.keys(require.cache)) if (key.endsWith(process.env.NOBODY_SETS_THIS ?? "lib.ts")) delete require.cache[key];
  const again = await import("./lib.ts");
  say(again.tick(), again.seen(), again.tick === lib.tick);
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-loader-stored-for-a-kind-of-file": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  require.extensions[".mine"] = (module: any) => { module.exports = 7; };
  say(require("./data.mine"));
  say(lib.tick(), lib.seen());
});
`,
    "data.mine": `whatever
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-path-that-nobody-reads-under-a-query": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  const copy = await import("./" + (process.env.NOBODY_SETS_THIS ?? "lib") + ".ts?again");
  say(copy.tick(), copy.seen(), copy.tick === lib.tick);
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-plugin-answers-for-a-file-that-has-not-loaded": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /late\\.ts$/ }, () => ({ contents: "export const late = 'the plugin';", loader: "js" })); } });
  say((await import("./late.ts")).late);
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-plugin-beside-a-cycle": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "export default 5;", loader: "js" })); } });
  say((await import("./ring-late")).report());
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
`,
    "lib.ts": `import { bump, read } from "./dep";
let own = 0;
export function tick() { return [++own, bump()]; }
export const seen = () => [own, read()];
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "ring-early.ts": `import { f } from "./ring-late";
export const seen = f();
`,
    "ring-late.ts": `import { seen } from "./ring-early";
const kept = 5;
export function f(touches = false) { return touches ? kept : "early"; }
export const report = () => [seen, f(true)];
`,
  },
  "a-plugin-beside-a-file-taken-out-by-a-spelled-key": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "export default 5;", loader: "js" })); } });
  delete require.cache[require.resolve("./lib.ts")];
  const again = await import("./lib.ts");
  say(again.tick(), again.seen(), again.tick === lib.tick);
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-plugin-comes-behind-the-load-of-the-file": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  say((await import("./late.ts")).late);
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /late\\.ts$/ }, () => ({ contents: "export const late = 'the plugin';", loader: "js" })); } });
  say((await import("./late.ts")).late);
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "a-plugin-loads-another-kind-of-file": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "export default 5;", loader: "js" })); } });
  say((await import("./data.mine")).default);
  say(lib.tick(), lib.seen());
});
`,
    "data.mine": `whatever
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "two-test-files-beside-a-plugin": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "export default 5;", loader: "js" })); } });
  say(lib.tick(), lib.seen());
});
`,
    "b.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("b", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  say(lib.tick(), lib.seen());
});
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  "what-the-plugin-gives-imports-a-file-of-the-program": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.tick(), lib.seen());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "import { bump, read } from './dep'; export default [bump(), read()];", loader: "js" })); } });
  say((await import("./data.mine")).default);
  say(lib.tick(), lib.seen());
});
`,
    "data.mine": `whatever
`,
    "dep.ts": `let count = 0;
export const bump = () => ++count;
export const read = () => count;
console.log("SEEN dep runs");
`,
    "late.ts": `export const late = "the file";
console.log("SEEN late runs");
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
  test.concurrent(
    `a text that nobody has read comes in: ${name}`,
    async () => {
      using dir = tempDir("aot-comes-in-or-is-taken-out", files);
      const seenWith = async (...flags: string[]) => {
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
        return {
          lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
          exitCode,
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.lines.length).toBeGreaterThan(2);
      expect(plain.exitCode).toBe(0);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );
}
