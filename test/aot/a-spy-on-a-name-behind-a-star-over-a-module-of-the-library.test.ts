import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// src/os.js says `export * from "node:os"`. A test hands the namespace object of that file to a helper that spies on it. The names behind the star show at run
// time, so the table of the file lists none of them, and as one program the run refused the spy: "Cannot spy on 'hostname' because module exports can't be replaced".
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "src/crypto.js": `export * from "node:crypto";
`,
  "src/os.js": `export * from "node:os";
`,
  "src/fs.js": `export * from "node:fs";
`,
  "src/util.js": `export const own = () => "own";
export * from "node:util";
`,
  "src/through.js": `export * from "./path.js";
`,
  "src/path.js": `export * from "node:path";
`,
  "src/two.js": `export * from "node:url";
export * from "node:querystring";
`,
  "src/uses.js": `import { randomUUID } from "./crypto.js";
import { hostname } from "./os.js";
import { existsSync } from "./fs.js";
import { format, own } from "./util.js";
import { basename } from "./through.js";
import { fileURLToPath, escape } from "./two.js";
export const uses = {
  crypto: () => typeof randomUUID(),
  os: () => typeof hostname(),
  fs: () => existsSync("/"),
  util: () => format("%s", 1),
  own: () => own(),
  through: () => basename("/x/y.js"),
  url: () => fileURLToPath("file:///a/b"),
  querystring: () => escape("a b"),
};
`,
  "a.test.js": `import { expect, spyOn, test } from "bun:test";
import * as crypto from "./src/crypto.js";
import * as os from "./src/os.js";
import * as fs from "./src/fs.js";
import * as util from "./src/util.js";
import * as through from "./src/through.js";
import * as two from "./src/two.js";
import { uses } from "./src/uses.js";

const said = ask => {
  try {
    return String(ask());
  } catch (error) {
    return error.name + ": " + error.message.split(" because")[0];
  }
};
function tried(label, holder, member, use) {
  const answer = said(() => {
    const spy = spyOn(holder, member).mockImplementation(() => "spied");
    try {
      return use() + " calls " + spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  });
  console.log("SEEN " + label + " | " + answer + " | then " + said(use));
}

test("a helper spies on names that a file passes on whole from a module of the library", () => {
  tried("crypto", crypto, "randomUUID", uses.crypto);
  tried("os", os, "hostname", uses.os);
  tried("fs", fs, "existsSync", uses.fs);
  tried("util", util, "format", uses.util);
  tried("a name of the file's own beside the star", util, "own", uses.own);
  tried("through two files", through, "basename", uses.through);
  tried("the first of two stars", two, "fileURLToPath", uses.url);
  tried("the second of two stars", two, "escape", uses.querystring);
  expect(1).toBe(1);
});
`,
  "b.test.js": `import { expect, spyOn, test } from "bun:test";
import * as os from "./src/os.js";
import { uses } from "./src/uses.js";

test("the spy is written out", () => {
  const spy = spyOn(os, "hostname").mockImplementation(() => 7);
  console.log("SEEN written out | " + uses.os() + " calls " + spy.mock.calls.length);
  spy.mockRestore();
  console.log("SEEN written out, restored | " + uses.os());
  expect(1).toBe(1);
});
`,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  // The workers of a parallel run say it on the other stream.
  const lines = (stdout + "\n" + stderr).split("\n");
  return { seen: lines.filter(line => line.startsWith("SEEN ")).sort(), exitCode };
}

test("a spy reaches a name that a file passes on by `export *` from a module of the library", async () => {
  using directory = tempDir("a-spy-on-a-name-behind-a-star", files);
  const plain = await seenIn(String(directory), undefined);
  expect(plain.seen).toContain("SEEN os | string calls 1 | then string");
  expect(plain.seen).toContain("SEEN fs | spied calls 1 | then true");
  expect(plain.seen).toHaveLength(10);
  expect(await seenIn(String(directory), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await seenIn(String(directory), "TestRunLayers:2,TestRunPartFiles:1", "--aot", "--parallel=2")).toEqual(plain);
}, 240_000);
