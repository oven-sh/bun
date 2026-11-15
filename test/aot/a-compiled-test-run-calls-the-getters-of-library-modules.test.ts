import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `promises` of node:fs and node:timers lies behind a getter. The module reaches the read through a value that the compiler does not
// follow, and the name is made at run time.
const reads = (module: string, read: string) => `import held from "node:${module}";
import { expect, test } from "bun:test";
const unfollowed = (await Promise.all([held]))[0];
const key = ["prom", "ises"].join("");
test("the read answers what the getter answers", () => {
  expect(typeof (${read})).toBe("object");
});
`;
const files = {
  "fs-by-key.test.js": reads("fs", "unfollowed[key]"),
  "fs-by-reflect-get.test.js": reads("fs", "Reflect.get(unfollowed, key)"),
  "fs-by-entries.test.js": reads("fs", "Object.fromEntries(Object.entries(unfollowed)).promises"),
  "timers-by-key.test.js": reads("timers", "unfollowed[key]"),
};

test.each(Object.keys(files))(
  "%s",
  async name => {
    using dir = tempDir("aot-getters-of-library-modules", files);
    const tested = await run([bunExe(), "test", "--aot", "./" + name], String(dir), bunEnv);
    expect(tested.stderr).toContain("1 pass");
    expect(tested.exitCode).toBe(0);
  },
  60_000,
);

test("all of them in one run", async () => {
  using dir = tempDir("aot-getters-of-library-modules", files);
  const tested = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(tested.stderr).toContain("4 pass");
  expect(tested.exitCode).toBe(0);
}, 60_000);

// `console.Console` is made at its first read. This file imports nothing and reads at its top level: inside a test, or beside an import
// of bun:test, the read was right.
test("console.Console", async () => {
  using dir = tempDir("aot-members-made-at-their-first-read", {
    "read.test.js": `const unfollowed = (await Promise.all([console]))[0];
const key = ["Con", "sole"].join("");
const member = unfollowed[key];
console.log("it is:", typeof member, member.length);
`,
  });
  const tested = await run([bunExe(), "test", "--aot", "./read.test.js"], String(dir), bunEnv);
  expect(tested.stdout).toEndWith("it is: function 1\n");
}, 60_000);
