// What lies in a private field leaves its class by one road: Bun.deepMatch(), toMatchObject() and expect.objectContaining() compare private fields too. Where the build follows an object to one of
// them, by the binding of the function that is called, it compiles the class for that. Where it cannot, a number or a text in the field is compared all the same, and an object in it is
// refused aloud: it was compiled as out of everybody's reach.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test as oneAtATime } from "./supported";

const test = oneAtATime.concurrent;
const refusal =
  "Cannot compare the private field #kept: the build saw no object with this field reach Bun.deepMatch(), toMatchObject() or expect.objectContaining(). Call the comparison directly, and create one of the two objects where you call it.";

const holder = `class Holder { #kept; constructor(kept) { this.#kept = kept; } }\n`;
const says = (call: string) =>
  `const says = (pattern, value) => { try { return String(${call}); } catch (error) { return error.message.split(" (bun compile")[0]; } };\n` +
  `const said = [[1, 1], [1, 2], ["a", "a"], [undefined, null], [{ a: 1 }, { a: 1 }]].map(([pattern, value]) => says(pattern, value));\n`;

describe("in an executable", () => {
  async function built(text: string) {
    const dir = tempDir("aot-comparison-of-private-fields", { "main.js": text });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"],
      String(dir),
      bunEnv,
    );
    expect(build.exitCode).toBe(0);
    const { stdout, exitCode } = await run([join(String(dir), "main")], String(dir), bunEnv);
    return { said: stdout.split("\n").slice(0, -1), exitCode };
  }

  test("Bun.deepMatch() by its own name compares the object", async () => {
    const text = `${holder}${says("Bun.deepMatch(new Holder(pattern), new Holder(value))")}console.log(said.join("\\n"));\n`;
    expect(await built(text)).toEqual({ said: ["true", "false", "true", "false", "true"], exitCode: 0 });
  });

  test("under a name that nobody knows it compares what is no object and refuses the object", async () => {
    const text = `${holder}globalThis.compare = Bun.deepMatch;\nconst compare = globalThis[JSON.parse('"compare"')];\n${says("compare(new Holder(pattern), new Holder(value))")}console.log(said.join("\\n"));\n`;
    expect(await built(text)).toEqual({ said: ["true", "false", "true", "false", refusal], exitCode: 0 });
  });
});

describe("in a test run", () => {
  async function ran(text: string) {
    const dir = tempDir("aot-comparison-of-private-fields", { "one.test.js": text });
    const { stdout, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    return { said: stdout.split("\n").filter(line => /^(undefined|Cannot|expect)/.test(line)), exitCode };
  }
  const matches = (expectation: string) =>
    `${says(`${expectation}(new Holder(value)).toMatchObject(new Holder(pattern))`)}test("says", () => console.log(said.join("\\n")));\n`;

  test("the imported expect() compares the object", async () => {
    const { said, exitCode } = await ran(`import { expect, test } from "bun:test";\n${holder}${matches("expect")}`);
    expect({ said: said.map(line => line.slice(0, 9)), exitCode }).toEqual({
      said: ["undefined", "expect(re", "undefined", "expect(re", "undefined"],
      exitCode: 0,
    });
  });

  test("two objects out of a table of test.each() are refused: the build follows neither", async () => {
    const text = `import { expect, test } from "bun:test";\n${holder}test.each([[new Holder({ a: 1 }), new Holder({ a: 1 })]])("says", (value, pattern) => {\n  try { console.log(String(expect(value).toMatchObject(pattern))); } catch (error) { console.log(error.message.split(" (bun compile")[0]); }\n});\n`;
    expect(await ran(text)).toEqual({ said: [refusal], exitCode: 0 });
  });

  test("expect() come by through a made name compares what is no object and refuses the object", async () => {
    const comes = `import * as runner from "bun:test";\nconst made = runner[JSON.parse('"expect"')];\n`;
    const { said, exitCode } = await ran(`import { test } from "bun:test";\n${comes}${holder}${matches("made")}`);
    expect({ last: said.at(-1), others: said.slice(0, -1).map(line => line.slice(0, 9)), exitCode }).toEqual({
      last: refusal,
      others: ["undefined", "expect(re", "undefined", "expect(re"],
      exitCode: 0,
    });
  });
});
