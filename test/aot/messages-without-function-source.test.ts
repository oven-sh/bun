// A message of the engine quotes the code that failed. An executable built without the text of functions has no code to quote, and what it prints may end in a report
// that others read: there a message names the kind of a primitive and never its value, and never spells a key that was reckoned at run time.
import { expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { beforeAll, describe, test } from "./supported";

const program = `const text = JSON.parse('"a text of the user"');
const number = JSON.parse("12345.678");
const big = BigInt(JSON.parse('"98765432123456789"'));
const symbol = Symbol(text);
const holder = JSON.parse('{"held":"another text of the user"}');
const key = JSON.parse('"held"');
const nothing = JSON.parse("[null]")[1];
const none = JSON.parse("null");
const declared = { kind: "k", type: "t", inline: true };
const cases = {
  "a text as key read on undefined": () => nothing[text],
  "a text as key read on null": () => none[text],
  "a number as key read on undefined": () => nothing[number],
  "a text as key stored on undefined": () => (nothing[text] = 1),
  "a text as key behind a name": () => holder.none[text],
  "a name read on undefined": () => nothing.count,
  "in on a text": () => "x" in text,
  "a text in a text": () => text in text,
  "in on a number": () => "x" in number,
  "in on a BigInt": () => "x" in big,
  "in on a symbol": () => "x" in symbol,
  "in on true": () => "x" in (number > 0),
  "in on null": () => "x" in none,
  "a declared name in an object that has it": () => "kind" in declared && "type" in declared && "inline" in declared,
  "kind in a string": () => "kind" in text,
  "type in a string": () => "type" in text,
  "kind in a number": () => "kind" in number,
  "inline in a string": () => "inline" in text,
  "two in tests in one expression": () => "kind" in text || "x" in text,
  "a call of a text": () => text(),
  "a call of a number": () => number(),
  "a call of a BigInt": () => big(),
  "a call of a symbol": () => symbol(),
  "new of a text": () => new text(),
  "a call of a member that holds a text": () => holder.held(),
  "a call of a member under a key": () => holder[key](),
  "a tagged template on a text": () => text\`x\`,
  "an optional call of a text": () => holder.held?.(),
  "a call of an object": () => holder(),
  "the result of a call is called": () => (() => text)()(),
  "what a Map gives is called": () => new Map([["k", text]]).get("k")(),
  "what ?? chooses is called": () => (none ?? text)(),
  "new of the result of a call": () => new ((() => text)())(),
  "a number out of a call is called": () => (() => number)()(),
  "the next of an iterator is a text": () => {
    for (const each of { [Symbol.iterator]: () => ({ next: text }) }) return each;
  },
};
for (const [name, fails] of Object.entries(cases)) {
  try {
    fails();
    console.log(name + " | nothing was thrown");
  } catch (error) {
    console.log(name + " | " + error.message);
  }
}
`;

describe("compile/aot/an executable without the text of functions prints no value in a message", () => {
  const root = String(tempDir("aot-no-value-in-a-message", {}));
  const path = (name: string) => join(root, isWindows ? name + ".exe" : name);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    writeFileSync(join(root, "main.js"), program);
    for (const [name, flags] of [
      ["with-text", []],
      ["without-text", ["--no-compile-function-source"]],
    ] as const) {
      const command = [
        bunExe(),
        ...compileCommand,
        ...withoutDebugInformation(),
        ...flags,
        "./main.js",
        "--outfile",
        path(name),
      ];
      built(await spawned(command, root, bunEnv));
    }
  }, 300_000);

  test("with the text it says what bun run says", async () => {
    const plain = await spawned([bunExe(), "./main.js"], root, bunEnv);
    const run = await spawned([path("with-text")], root, bunEnv);
    expect(plain.stdout).toContain(
      `a call of a text | text is not a function. (In 'text()', 'text' is "a text of the user")\n`,
    );
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("without it no message holds a value", async () => {
    const run = await spawned([path("without-text")], root, bunEnv);
    const lines = run.stdout.trimEnd().split("\n");
    expect(lines.filter(line => /of the user|12345|98765/.test(line))).toEqual([]);
    expect({ lines, exitCode: run.exitCode }).toEqual({
      lines: [
        "a text as key read on undefined | undefined is not an object",
        "a text as key read on null | null is not an object",
        "a number as key read on undefined | undefined is not an object",
        "a text as key stored on undefined | undefined is not an object",
        "a text as key behind a name | undefined is not an object",
        "a name read on undefined | undefined is not an object (evaluating 'undefined.count')",
        "in on a text | a string is not an Object.",
        "a text in a text | a string is not an Object.",
        "in on a number | a number is not an Object.",
        "in on a BigInt | a BigInt is not an Object.",
        "in on a symbol | a symbol is not an Object.",
        "in on true | a boolean is not an Object.",
        "in on null | null is not an Object.",
        "a declared name in an object that has it | nothing was thrown",
        "kind in a string | a string is not an Object.",
        "type in a string | a string is not an Object.",
        "kind in a number | a number is not an Object.",
        "inline in a string | a string is not an Object.",
        "two in tests in one expression | a string is not an Object.",
        "a call of a text | text is not a function. (In 'text()', 'text' is a string)",
        "a call of a number | number is not a function. (In 'number()', 'number' is a number)",
        "a call of a BigInt | big is not a function. (In 'big()', 'big' is a BigInt)",
        "a call of a symbol | symbol is not a function. (In 'symbol()', 'symbol' is a Symbol)",
        "new of a text | a string is not a constructor (evaluating 'new text')",
        "a call of a member that holds a text | holder.held is not a function. (In 'holder.held()', 'holder.held' is a string)",
        "a call of a member under a key | holder[key] is not a function. (In 'holder[key]()', 'holder[key]' is a string)",
        "a tagged template on a text | text is not a function. (In 'text()', 'text' is a string)",
        "an optional call of a text | holder.held is not a function. (In 'holder.held()', 'holder.held' is a string)",
        "a call of an object | holder is not a function. (In 'holder()', 'holder' is an instance of Object)",
        "the result of a call is called | a string is not a function",
        "what a Map gives is called | a string is not a function",
        "what ?? chooses is called | a string is not a function",
        "new of the result of a call | a string is not a constructor",
        "a number out of a call is called | a number is not a function",
        "the next of an iterator is a text | a string is not a function",
      ],
      exitCode: 0,
    });
  });
});
