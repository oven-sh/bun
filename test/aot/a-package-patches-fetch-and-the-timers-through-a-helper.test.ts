// A package that helps tests replaces `fetch` or a timer through a helper that is handed the object and the name.
// Where no build can read the object or the name the write is refused, and the refusal says how the write can be seen.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("a write under a name that no build can read is told how to be seen", async () => {
  using dir = tempDir("a-package-patches-fetch-and-the-timers-through-a-helper", {
    "package.json": `{ "name": "p" }`,
    "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "type": "module", "main": "index.mjs" }`,
    "node_modules/patches/index.mjs": `
      const names = [process.env.NAME_OF_WHAT_IS_PATCHED];
      export function patch(owner) { for (const name of names) owner[name] = () => 1; }`,
    "whole.test.cjs": `
      const runner = require("bun:test");
      runner.test("t", () => {
        const holder = { it: new Function("return this")() };
        try { require("patches").patch(holder.it); console.log("SEEN", typeof fetch); } catch (error) { console.log("SEEN", error.message); }
      });`,
  });
  const env = { ...bunEnv, NAME_OF_WHAT_IS_PATCHED: "fetch" };
  const { stdout } = await run([bunExe(), "test", "--aot"], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN"));
  expect(seen.length).toBe(1);
  // A test can replace fetch.
  expect(seen[0]).not.toContain("a test can't replace this one");
  expect(seen[0]).toContain(`as in globalThis.fetch = f or spyOn(globalThis, "fetch")`);
});
