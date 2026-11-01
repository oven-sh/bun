// A package that helps tests replaces `fetch` or a timer through a helper that is handed the object and the name: `registry.applyPatch(globalThis, "fetch", wrap)`
// (@mswjs/interceptors, so nock and msw). The build follows such a write by flow. Where a test file lets `spyOn` or the object of bun:test go out of sight flow
// no longer knows what the helper is handed, the member was locked when the run began, and the write was refused. In a file of the project the object beside the
// name has always counted. In a package it now counts for the members that are tested where they are used anyway.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "type": "module", "main": "index.mjs" }`,
  "node_modules/patches/registry.mjs": `
    class Registry {
      applyPatch(owner, key, next) {
        const before = Object.getOwnPropertyDescriptor(owner, key);
        Object.defineProperty(owner, key, { value: next(owner[key]), enumerable: true, configurable: true });
        return () => Object.defineProperty(owner, key, before);
      }
    }
    export const registry = new Registry();
    export function store(owner, key, value) {
      const before = owner[key];
      owner[key] = value;
      return () => { owner[key] = before; };
    }`,
  "node_modules/patches/index.mjs": `
    import { registry, store } from "./registry.mjs";
    export function patchFetch() {
      return registry.applyPatch(globalThis, "fetch", real => (...all) => real(...all));
    }
    export const patchTimeout = () => store(globalThis, "setTimeout", () => "no timer");
    export class Patches {
      undo = store(globalThis, "setInterval", () => "no interval");
      clear() { return registry.applyPatch(globalThis, "clearTimeout", () => () => "cleared"); }
    }`,
  "whole.test.cjs": `
    const runner = require("bun:test");
    runner.test("t", () => {
      const { patchFetch, patchTimeout, Patches } = require("patches");
      const real = [fetch, setTimeout, setInterval, clearTimeout];
      const now = () => [fetch, setTimeout, setInterval, clearTimeout].map((it, index) => it === real[index]).join();
      const patches = new Patches();
      const undo = [patchFetch(), patchTimeout(), patches.undo, patches.clear()];
      console.log("SEEN", now(), setTimeout(() => {}, 1), setInterval(() => {}, 1), clearTimeout(0));
      for (const one of undo) one();
      console.log("SEEN", now());
    });`,
};

const forms = { "one program": "TestRunLayers:0", "two layers": "TestRunLayers:2,TestRunPartFiles:1" };

for (const [title, words] of Object.entries(forms)) {
  test(`where the object of bun:test is out of sight: ${title}`, async () => {
    using dir = tempDir("a-package-patches-fetch-and-the-timers-through-a-helper", files);
    const seen = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n").filter(line => line.startsWith("SEEN"));
    };
    const plain = await seen();
    expect(plain).toEqual(["SEEN false,false,false,false no timer no interval cleared", "SEEN true,true,true,true"]);
    expect(await seen("--aot")).toEqual(plain);
  });
}

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
        const holder = { it: globalThis };
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
