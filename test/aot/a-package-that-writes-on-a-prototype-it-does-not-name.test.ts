// A test build opens the members of built-in objects that the tests replace. `Object.getPrototypeOf(x).name = ..` names no object, so the build guesses:
// Object.prototype or Function.prototype. That guess is for what a test means. A package means the prototype of its own class (zod gives the prototype of
// its errors a `toString` that way), and one such line opened Object.prototype.toString for every String(x) of the whole run.
// So a package's write on a prototype that it does not name opens nothing. Where it does hit Object.prototype, it either works as in plain Bun, because flow
// saw it, or throws the TypeError that names the member, as in an executable. What it may never do is pass unseen.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

const files = {
  "node_modules/planter/package.json": `{ "name": "planter", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/planter/index.js": `
    export function plant(on, name, value) { Object.defineProperty(Object.getPrototypeOf(on), name, { value, configurable: true, writable: true }); }
    export function plantOnObjects() { plant({}, "planted", 1); }
    export function replaceToString() { plant({}, "toString", () => "replaced"); }`,
  "reader.ts": `export function read(it: any) { return [it.planted, String(it)]; }`,
  "one.test.ts": `
    import { test } from "bun:test";
    import { plant, plantOnObjects, replaceToString } from "planter";
    import { read } from "./reader";
    class Own { message = "own"; }
    const tried = (title: string, act: () => void) => {
      let thrown = "";
      try { act(); } catch (error) { thrown = (error as Error).name + ": " + (error as Error).message; }
      console.log(title, JSON.stringify(read({})), JSON.stringify(read(new Own())), thrown);
    };
    test("writes", () => {
      tried("its own class", () => plant(new Own(), "toString", function (this: Own) { return this.message; }));
      tried("a new name", plantOnObjects);
      tried("toString", replaceToString);
    });`,
};

for (const [title, words] of Object.entries({
  "one program": "TestRunLayers:0",
  "two layers": "TestRunLayers:2,TestRunPartFiles:1",
})) {
  test(`a package's write on a prototype that it does not name works or throws, and is never lost: ${title}`, async () => {
    using dir = tempDir("a-package-writes-on-a-prototype", files);
    const lines = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n").filter(line => /^(its own class|a new name|toString) /.test(line));
    };
    const [plain, compiled] = [await lines(), await lines("--aot")];
    expect(plain).toHaveLength(3);
    // Its own class: nothing of a built-in object is written.
    expect(compiled[0]).toBe(plain[0]);
    const refused = [
      // Nothing was written, and the error names the member.
      expect.stringMatching(/^a new name \[null,"\[object Object\]"\] \[null,"own"\] TypeError: .*planted/),
      expect.stringMatching(/^toString \[null,"\[object Object\]"\] \[null,"own"\] TypeError: .*toString/),
    ];
    for (const [at, line] of compiled.slice(1).entries()) {
      // What the line before it did shows in this one too, so a line is judged by what it adds: the first may be refused and the second work.
      const added = (text: string) => (at ? text.replaceAll("[1,", "[null,") : text);
      if (added(line) !== added(plain[at + 1])) expect(line.replace("[1,", "[null,")).toEqual(refused[at]);
    }
  });
}
