import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Two classes with the same text, one in a helper and one in the test file. Over layers they lie in two images, where each is the layout of the same number.
const body = (whose: string) =>
  `{ #secret = "${whose}"; secret() { return this.#secret; } static has(v) { return #secret in v; } static set(v, x) { v.#secret = x; return v.#secret; } #hidden() { return "${whose} method"; } callHidden() { return this.#hidden(); } }`;
const testFile = `import { expect, test } from "bun:test";
import * as theirs from "./helpers/theirs.js";
class Animal ${body("mine")}
const said = (ask) => { try { return JSON.stringify(ask()); } catch (error) { return error.name; } };
test("private names of two classes with one text", () => {
  const rows = {
    "mine reads theirs": () => Animal.prototype.secret.call(new theirs.Animal()),
    "theirs reads mine": () => theirs.Animal.prototype.secret.call(new Animal()),
    "mine in theirs": () => Animal.has(new theirs.Animal()),
    "theirs in mine": () => theirs.Animal.has(new Animal()),
    "mine writes theirs": () => { const t = new theirs.Animal(); return [Animal.set(t, "written"), t.secret()]; },
    "theirs writes mine": () => { const m = new Animal(); return [theirs.Animal.set(m, "written"), m.secret()]; },
    "my method on theirs": () => Animal.prototype.callHidden.call(new theirs.Animal()),
    "their method on mine": () => theirs.Animal.prototype.callHidden.call(new Animal()),
    "mine on mine": () => [Animal.has(new Animal()), new Animal().secret(), new Animal().callHidden()],
    "theirs on theirs": () => [theirs.Animal.has(new theirs.Animal()), new theirs.Animal().secret(), new theirs.Animal().callHidden()],
  };
  for (const name of Object.keys(rows)) console.log("SEEN " + name + " | " + said(rows[name]));
  expect(1).toBe(1);
});
`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "helpers/theirs.js": `export class Animal ${body("theirs")}\n`,
  "a.test.js": testFile,
  "b.test.js": testFile,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("a private name is not found on an object of a class with the same text in another layer", async () => {
  using dir = tempDir("aot-private-names-in-two-layers", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain.seen.slice(0, 10)).toEqual([
    "SEEN mine reads theirs | TypeError",
    "SEEN theirs reads mine | TypeError",
    "SEEN mine in theirs | false",
    "SEEN theirs in mine | false",
    "SEEN mine writes theirs | TypeError",
    "SEEN theirs writes mine | TypeError",
    "SEEN my method on theirs | TypeError",
    "SEEN their method on mine | TypeError",
    `SEEN mine on mine | [true,"mine","mine method"]`,
    `SEEN theirs on theirs | [true,"theirs","theirs method"]`,
  ]);
  expect(await seenIn(String(dir), undefined, "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
});
