import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case builds and runs in a folder of its own.
const test = oneAtATime.concurrent;

// Which files of a test run load again is known by file. Each project does one thing that shows where a file was left out of the list, or one beside it was not.

const born = (name: string) =>
  `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;

/** As expectCompiledToRunAsPlain(), for a run that changes its own files: each of the two runs finds them as they are written here. */
async function expectCompiledToRunAsPlainInFolderOfItsOwn(files: Record<string, string>) {
  const test = async (...flags: string[]) => {
    using dir = tempDir("files-that-load-again", files);
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
    const passed = [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]);
    return { stdout, passed, exitCode };
  };
  const plain = await test();
  expect(plain.exitCode).toBe(0);
  expect(plain.passed).not.toEqual([]);
  expect(await test("--aot")).toEqual(plain);
}

test("one file is taken out by its key, and the files beside it keep what they hold", async () => {
  await expectCompiledToRunAsPlain({
    "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
    "beside.js": `${born("beside")}export function bump() { return me + ":" + ++calls; }`,
    "user.js": `import { bump } from "./state.js";\nimport { bump as beside } from "./beside.js";\n${born("user")}export function viaUser() { return me + " > " + bump() + " " + beside(); }`,
    "one.test.js": `
      import { test } from "bun:test";
      import { viaUser } from "./user.js";
      test("taken out", async () => {
        console.log(viaUser());
        delete require.cache[require.resolve("./state.js")];
        const again = await import("./state.js");
        const beside = await import("./beside.js");
        console.log(viaUser(), again.bump(), beside.bump(), require("./state.js").bump());
      });`,
  });
});

// The run time refuses what the build has not seen. So the refusal shows that the file beside the one that leaves is still compiled for a module that loads once.
test("beside a file that the build sees taken out, the others still load once", async () => {
  using dir = tempDir("files-that-load-again", {
    "state.ts": `export let count = 0;\nexport function bump() { return ++count; }`,
    "beside.ts": `export let count = 0;\nexport function bump() { return ++count; }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { bump as bumpBeside } from "./beside";
      import { bump } from "./state";
      test("one is taken out, one is refused", async () => {
        const written = join(import.meta.dir, "written-" + process.pid + ".cjs");
        writeFileSync(written, "module.exports = path => delete require.cache[path];");
        const takeOut = require(written);
        bump();
        bumpBeside();
        delete require.cache[require.resolve("./state")];
        let message = "";
        try { takeOut(require.resolve("./beside")); } catch (error) { message = (error as Error).message; }
        console.log(message.replaceAll(import.meta.dir, "").replaceAll("\\\\", "/").split(":")[0]);
        console.log((await import("./state")).count, (await import("./beside")).count);
      });`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect({ stdout: stdout.split("\n").slice(1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
    stdout: ["Cannot delete '/beside.ts' from require.cache", "0 1", ""],
    stderr: "",
    exitCode: 0,
  });
});

test("a file that has yet to run binds the instance that the loader holds by then", async () => {
  await expectCompiledToRunAsPlain({
    "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
    "early.js": `import { bump } from "./state.js";\n${born("early")}export const viaEarly = () => me + " > " + bump();`,
    "late.js": `import { bump } from "./state.js";\n${born("late")}export const viaLate = () => me + " > " + bump();`,
    "above-late.js": `export { viaLate } from "./late.js";\n${born("above")}export const above = me;`,
    "one.test.js": `
      import { test } from "bun:test";
      import { viaEarly } from "./early.js";
      test("taken out in front of the import", async () => {
        console.log(viaEarly());
        delete require.cache[require.resolve("./state.js")];
        const { above, viaLate } = await import("./above-late.js");
        console.log(viaEarly(), viaLate(), above, (await import("./state.js")).bump());
      });`,
  });
});

test("the copy from disk asks for names that the file alone imports", async () => {
  await expectCompiledToRunAsPlain({
    "base.js": `${born("base")}export const base = () => me;\nexport const unread = "unread";`,
    "deep.js": `${born("deep")}export const deep = () => me;`,
    "barrel.js": `export { base as renamed } from "./base.js";\nexport * from "./deep.js";`,
    "state.js": `import { deep, renamed } from "./barrel.js";\n${born("state")}export const tell = () => [me, renamed(), deep()].join(" ");`,
    "one.test.js": `
      import { test } from "bun:test";
      import { tell } from "./state.js";
      test("through a barrel", async () => {
        console.log(tell());
        delete require.cache[require.resolve("./state.js")];
        console.log(tell(), (await import("./state.js")).tell(), require("./state.js").tell());
      });`,
  });
});

test("the copy from disk begins a file that nothing has run yet", async () => {
  await expectCompiledToRunAsPlain({
    "asleep.js": `${born("asleep")}export const asleep = () => me + ":" + ++calls;`,
    "state.js": `${born("state")}export const tell = async () => me + " " + (await import("./asleep.js")).asleep();`,
    "one.test.js": `
      import { test } from "bun:test";
      import { tell } from "./state.js";
      test("loaded by the copy first", async () => {
        delete require.cache[require.resolve("./state.js")];
        const again = await import("./state.js");
        console.log(await again.tell(), await tell(), await again.tell());
      });`,
  });
});

test("a CommonJS file that is taken out runs again where a function requires it", async () => {
  await expectCompiledToRunAsPlain({
    "state.cjs": `${born("state")}exports.bump = () => me + ":" + ++calls;`,
    "below.cjs": `${born("below")}exports.bump = () => me + ":" + ++calls;`,
    "user.cjs": `const below = require("./below.cjs");\n${born("user")}exports.viaUser = () => [me, require("./state.cjs").bump(), below.bump()].join(" ");`,
    "one.test.js": `
      import { test } from "bun:test";
      import { viaUser } from "./user.cjs";
      test("taken out between two calls", () => {
        console.log(viaUser());
        delete require.cache[require.resolve("./state.cjs")];
        console.log(viaUser(), viaUser());
      });`,
  });
});

test("one file of a cycle is taken out", async () => {
  await expectCompiledToRunAsPlain({
    "a.js": `import { nameOfB } from "./b.js";\n${born("a")}export function nameOfA() { return me; }\nexport const both = () => me + " " + nameOfB();`,
    "b.js": `import { nameOfA } from "./a.js";\n${born("b")}export function nameOfB() { return me; }\nexport const both = () => me + " " + nameOfA();`,
    "one.test.js": `
      import { test } from "bun:test";
      import * as a from "./a.js";
      import * as b from "./b.js";
      test("taken out", async () => {
        console.log(a.both(), b.both());
        delete require.cache[require.resolve("./b.js")];
        const again = await import("./b.js");
        console.log(a.both(), b.both(), again.both(), again === b);
      });`,
  });
});

test("a CommonJS file whose body throws runs again at the next require()", async () => {
  await expectCompiledToRunAsPlain({
    "below.cjs": `${born("below")}exports.bump = () => me + ":" + ++calls;`,
    "thrower.cjs": `const below = require("./below.cjs");\n${born("thrower")}if (births.thrower < 2) throw new Error("thrown by " + me);\nexports.tell = () => me + " " + below.bump();`,
    "late.js": `import thrower from "./thrower.cjs";\n${born("late")}export const viaLate = () => me + " > " + thrower.tell();`,
    "one.test.js": `
      import { test } from "bun:test";
      test("caught", async () => {
        let message = "";
        try { require("./thrower.cjs"); } catch (error) { message = error.message; }
        console.log(message);
        console.log(require("./thrower.cjs").tell(), require("./thrower.cjs").tell());
        console.log((await import("./late.js")).viaLate());
      });`,
  });
});

test("whoever is handed a function catches what the file that it requires throws", async () => {
  await expectCompiledToRunAsPlain({
    "thrower.cjs": `${born("thrower")}if (births.thrower < 3) throw new Error("thrown by " + me);\nexports.tell = () => me + ":" + ++calls;`,
    "one.test.js": `
      import { expect, test } from "bun:test";
      const load = () => require("./thrower.cjs");
      test("caught by expect()", () => {
        expect(() => require("./thrower.cjs")).toThrow("thrown by thrower#1");
        expect(load).toThrow("thrown by thrower#2");
        console.log(load().tell(), require("./thrower.cjs").tell());
      });`,
  });
});

test("a file that the run writes anew imports what nothing else in the run imports", async () => {
  await expectCompiledToRunAsPlainInFolderOfItsOwn({
    "far.js": `${born("far")}export const read = () => me;\nexport const unread = () => me + " unread";`,
    "never-imported.js": `${born("never")}export const never = () => me;`,
    "state.js": `import { read } from "./far.js";\nexport const tell = () => "old " + read();`,
    "beside.js": `${born("beside")}export const beside = () => me + ":" + ++calls;`,
    "one.test.js": `
      import { test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { beside } from "./beside.js";
      test("written in front of its first load", async () => {
        writeFileSync(
          join(import.meta.dir, "state.js"),
          'import { unread } from "./far.js";\\nimport { never } from "./never-imported.js";\\nexport const tell = () => "new " + unread() + " " + never();',
        );
        console.log(beside(), (await import("./state.js")).tell(), beside());
      });`,
  });
});

test("a file that the run writes anew behind its first load is read when it is taken out", async () => {
  await expectCompiledToRunAsPlainInFolderOfItsOwn({
    "far.js": `${born("far")}export const read = () => me;\nexport const unread = () => me + " unread";`,
    "state.js": `import { read } from "./far.js";\nexport const tell = () => "old " + read();`,
    "user.js": `import { tell } from "./state.js";\n${born("user")}export const viaUser = () => me + " > " + tell();`,
    "one.test.js": `
      import { test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { viaUser } from "./user.js";
      test("written, then taken out", async () => {
        console.log(viaUser());
        writeFileSync(
          join(import.meta.dir, "state.js"),
          'import { unread } from "./far.js";\\nexport const tell = () => "new " + unread();',
        );
        console.log(viaUser(), (await import("./state.js")).tell());
        delete require.cache[require.resolve("./state.js")];
        console.log(viaUser(), (await import("./state.js")).tell());
      });`,
  });
});

test("what an import attribute makes of a file leaves with the file", async () => {
  await expectCompiledToRunAsPlainInFolderOfItsOwn({
    "data.json": `{ "word": "first" }`,
    "reader.js": `import data from "./data.json";\nimport text from "./data.json" with { type: "text" };\nexport const read = () => data.word + " " + text.length;`,
    "one.test.js": `
      import { test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      test("written in front of its first load", async () => {
        writeFileSync(join(import.meta.dir, "data.json"), '{ "word": "the second" }');
        console.log((await import("./reader.js")).read());
      });`,
  });
});

test("an entry under a key that is put together answers require() of a module of the library", async () => {
  await expectCompiledToRunAsPlain({
    "stub.cjs": `exports.stub = (parts, exports) => { require.cache[parts.join("")] = { exports }; };\nexports.clear = parts => { delete require.cache[parts.join("")]; };`,
    "user.cjs": `exports.kind = () => typeof require("url").parse;`,
    "one.test.js": `
      import { test } from "bun:test";
      import { clear, stub } from "./stub.cjs";
      import { kind } from "./user.cjs";
      test("stored and cleared", () => {
        console.log(kind());
        stub(["u", "rl"], { parse: 1 });
        console.log(kind());
        clear(["u", "rl"]);
        console.log(kind());
      });`,
  });
});
