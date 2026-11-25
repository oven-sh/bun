import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// One file that names Bun.plugin marks every file of a test run as one that may be evicted. An ES module that is evicted is left to plain's loader, and the body that was
// compiled is not entered again, so the build takes what that one run laid as settled, as in an executable: tests/link/body-of-a-file-that-may-be-evicted-runs-at-most-once.ir
// and tests/walk/folding/dead-zone-of-a-file-that-may-be-evicted-is-left-once.ir hold the marks. Here each shape is a project of its own, held against plain `bun test`.
const plugin = `Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /\\.mine$/ }, () => ({ contents: "export default 5;", loader: "js" })); } });`;
const shapes: Record<string, Record<string, string>> = {
  "a-const-is-read-in-its-dead-zone-and-behind-it": {
    "a.test.ts": `import { test } from "bun:test";
import { first, peek, twice } from "./ring-a";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  ${plugin}
  say(first, peek(), twice());
  say((await import("./data.mine")).default, peek(), twice());
});
`,
    "data.mine": `whatever
`,
    "ring-a.ts": `import { early } from "./ring-b";
export const first = early;
export const LIMIT = Number(process.env.NOBODY_SETS_THIS ?? 3);
export function peek() { try { return LIMIT; } catch (error) { return (error as Error).name; } }
export function twice() { const one = LIMIT; peek(); return one + LIMIT; }
`,
    "ring-b.ts": `import { peek } from "./ring-a";
export const early = peek();
console.log("SEEN ring-b runs", early);
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-copy-under-a-query-has-a-table-a-class-and-a-record-of-its-own": {
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(lib.add("a"), lib.add("b"), lib.make().who(), lib.limit());
  const copy = await import("./" + (process.env.NOBODY_SETS_THIS ?? "lib") + ".ts?again");
  say(copy.add("c"), copy.make().who(), copy.limit(), copy.Box === lib.Box, copy.make() instanceof lib.Box, copy.config === lib.config);
  copy.config.limit = 9;
  say(lib.add("d"), lib.make().who(), lib.limit(), copy.limit(), lib.Box.made, copy.Box.made);
});
`,
    "lib.ts": `const table = new Map<string, number>();
export const config = { limit: 3 };
export class Box { static made = 0; id = ++Box.made; who() { return "box " + this.id; } }
export const add = (key: string) => { table.set(key, table.size); return [...table.keys()]; };
export const make = () => new Box();
export function limit() { return config.limit; }
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-file-that-has-run-loads-late-a-file-that-a-plugin-answers-for": {
    "a.test.ts": `import { test } from "bun:test";
import { ask, count } from "./lib";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  say(count());
  Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /late\\.ts$/ }, () => ({ contents: "import { count } from './lib.ts'; export const LATE = 'the plugin ' + count(); export const tell = () => LATE;", loader: "ts" })); } });
  say(await ask(), count());
  say(await ask(), count());
});
`,
    "late.ts": `import { count } from "./lib";
export const LATE = "the file " + count();
export const tell = () => LATE;
console.log("SEEN late runs");
`,
    "lib.ts": `let calls = 0;
export const count = () => ++calls;
export const ask = async () => { const late = await import("./late.ts"); return [late.LATE, late.tell()]; };
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-second-test-file-finds-what-the-first-left-in-a-file-of-the-program": {
    "a.test.ts": `import { test } from "bun:test";
import { LIST, push, Kind } from "./lib";
test("a", () => {
  ${plugin}
  console.log("SEEN a", JSON.stringify([push("a"), LIST.length, Kind.One]));
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { LIST, push, Kind } from "./lib";
test("b", async () => {
  console.log("SEEN b", JSON.stringify([push("b"), LIST.length, Kind.Two, (await import("./data.mine")).default]));
});
`,
    "data.mine": `whatever
`,
    "lib.ts": `export const LIST: string[] = [];
export const Kind = { One: 1, Two: 2 } as const;
export const push = (text: string) => { LIST.push(text); return LIST.join(); };
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-file-that-names-a-plugin-resets-the-modules": {
    "a.test.ts": `import { test, vi } from "bun:test";
import { Box, KEY, bump, tag } from "./lib";
test("a", async () => {
  Bun.plugin({ name: "p", setup() {} });
  console.log("SEEN", JSON.stringify([bump(), bump(), tag({ [KEY]: "mine" }), new Box().id]));
  vi.resetModules();
  const again = await import("./lib");
  console.log("SEEN", JSON.stringify([again.bump(), bump(), again.KEY === KEY, again.Box === Box, again.tag({ [KEY]: "mine" }), tag({ [KEY]: "mine" }), new again.Box().id, new Box().id]));
});
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-file-that-names-a-plugin-takes-every-key-out-of-the-table": {
    "a.test.ts": `import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { Box, KEY, bump, tag } from "./lib";
test("a", async () => {
  Bun.plugin({ name: "p", setup() {} });
  console.log("SEEN", JSON.stringify([bump(), bump(), tag({ [KEY]: "mine" }), new Box().id]));
  Object.keys(require.cache).forEach(key => delete require.cache[key]);
  const again = await import("./lib");
  console.log("SEEN", JSON.stringify([again.bump(), bump(), again.KEY === KEY, again.Box === Box, again.tag({ [KEY]: "mine" }), tag({ [KEY]: "mine" }), new again.Box().id, new Box().id]));
});
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-file-that-threw-is-asked-for-again": {
    "a.test.ts": `import { test } from "bun:test";
import { bump } from "./lib";
test("a", async () => {
  ${plugin}
  const ask = () => import("./thrower").then(it => [it.LATE, it.tell()], error => (error as Error).message);
  console.log("SEEN", JSON.stringify([await ask(), bump()]));
  (globalThis as any).mayPass = true;
  console.log("SEEN", JSON.stringify([await ask(), bump()]));
  console.log("SEEN", JSON.stringify([await ask(), bump()]));
});
`,
    "thrower.ts": `import { bump } from "./lib";
console.log("SEEN thrower runs", bump());
if (!(globalThis as any).mayPass) throw new Error("not yet");
export const LATE = "late " + bump();
export const tell = () => LATE;
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-file-awaits-at-its-top-level": {
    "a.test.ts": `import { test } from "bun:test";
import { FIRST, SECOND, both } from "./waits";
test("a", async () => {
  ${plugin}
  console.log("SEEN", JSON.stringify([FIRST, SECOND, both()]));
  console.log("SEEN", JSON.stringify([(await import("./data.mine")).default, both()]));
});
`,
    "data.mine": `whatever
`,
    "waits.ts": `import { bump } from "./lib";
export const FIRST = bump();
await Promise.resolve();
export const SECOND = bump();
export const both = () => [FIRST, SECOND, bump()];
console.log("SEEN waits runs");
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "a-preload-has-loaded-the-file": {
    "a.test.ts": `import { test } from "bun:test";
import { Box, bump } from "./lib";
test("a", async () => {
  ${plugin}
  console.log("SEEN", JSON.stringify([bump(), new Box().id, (globalThis as any).ofPreload()]));
});
`,
    "bunfig.toml": `[test]
preload = ["./before.ts"]
`,
    "before.ts": `import { Box, bump } from "./lib";
(globalThis as any).ofPreload = () => [bump(), new Box().id];
console.log("SEEN before runs", bump());
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
  "each-test-file-runs-twice": {
    "a.test.ts": `import { test } from "bun:test";
import { Box, bump } from "./lib";
const OWN = bump();
test("a", async () => {
  ${plugin}
  console.log("SEEN", JSON.stringify([OWN, bump(), new Box().id]));
});
`,
    "lib.ts": `let calls = 0;
export const KEY = Symbol("key");
export class Box { static made = 0; id = ++Box.made; }
export const bump = () => ++calls;
export const tag = (held: any) => held[KEY] ?? "none";
console.log("SEEN lib runs");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
  },
};
const flagsOf: Record<string, string[]> = { "each-test-file-runs-twice": ["--rerun-each", "2"] };

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(
    `a file that may be evicted keeps what its one run laid: ${name}`,
    async () => {
      using dir = tempDir("aot-evicted-keeps-what-its-run-laid", files);
      const seenWith = async (...flags: string[]) => {
        const { stdout, stderr, exitCode } = await run(
          [bunExe(), "test", ...(flagsOf[name] ?? []), ...flags],
          String(dir),
          bunEnv,
        );
        return {
          lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
          exitCode,
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.lines.length).toBeGreaterThan(1);
      expect(plain.exitCode).toBe(0);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );
}
