// `expect.any(Function)` stands in every other test file. `Function` evaluates text, and as the operand of a call it counted as gone where nobody sees what it is called with:
// "the file evaluates a text that nobody knows", so a spy could be laid under any name and every export of every file could be replaced.
// `expect`, its members, and the members of what it answers compare what they are handed. They call none of it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const ways: Record<string, { text: string; anyName: boolean }> = {
  "expect.any(Function)": {
    text: `expect({ ...math }).toEqual({ half: expect.any(Function), kept: expect.any(Function) });`,
    anyName: false,
  },
  "toBeInstanceOf(Function)": { text: `expect(math.half).toBeInstanceOf(Function);`, anyName: false },
  "not.toBe(Function)": { text: `expect(math.half).not.toBe(Function);`, anyName: false },
  "not.toBe(eval)": { text: `expect(math.half).not.toBe(eval);`, anyName: false },
  "in the calls of a mock": {
    text: `const taken = mock(); taken(math.half); expect(taken).toHaveBeenCalledWith(expect.any(Function));`,
    anyName: false,
  },
  "expect under another name": {
    text: `const check = expect; check(math.half).toBeInstanceOf(Function);`,
    anyName: false,
  },
  // What `Function` evaluates is global code, which sees no name of the file: global-code-gets-the-runner-only-where-the-build-sees-it.test.ts.
  "a text that is made": { text: `new Function("return " + String(Math.floor(Math.random() * 0)))();`, anyName: false },
  "handed to a function that nobody knows": { text: `(globalThis.take ?? (it => it))(Function);`, anyName: false },
  "kept in a list": { text: `const held = [Function]; say(held.length);`, anyName: false },
  // A direct eval sees what the file names.
  "a direct eval of a text that is made": {
    text: `eval("1 + " + String(Math.floor(Math.random() * 0)));`,
    anyName: true,
  },
};

for (const [name, { text, anyName }] of Object.entries(ways))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-expect-only-compares", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "math.js": `export function half(n) { return n / 2; }\nexport function kept(n) { return n; }\n`,
      "reader.js": `import { half, kept } from "./math.js";\nexport const read = () => [half(4), kept(4)].join();\n`,
      "a.test.js": `import { expect, mock, test } from "bun:test";\nimport * as math from "./math.js";\nimport { read } from "./reader.js";\nconst say = it => console.error("SEEN " + it);\ntest("t", () => { ${text} say(read()); });\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")).at(-1),
        found: lines
          .flatMap(
            line =>
              /variables that tests may replace \d+ in .* a spy under any name (true|false)/.exec(line)?.slice(1, 2) ??
              [],
          )
          .slice(0, 1),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: "SEEN 2,4", found: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen: "SEEN 2,4", found: [String(anyName)], exitCode: 0 });
  });
