// `bun test` hands every file the names of the test runner. A build gives a file that uses one without an import a local of a name that no program can write,
// and a message quoted that name: "TypeError: %test:jest.noSuchFunction is not a function". Whoever moves a suite over from jest meets such a message first.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const lines = [
  `jest.noSuchFunction()`,
  `vi.noSuchFunction()`,
  `expect.noSuchMatcher()`,
  `new jest.NoSuchClass()`,
  `jest.noSuchObject.member`,
  `jest.noSuchObject.member()`,
  `jest()`,
  `new vi()`,
  `null instanceof jest`,
];

async function messagesOf(name: string, flags: string[]) {
  const asks = lines.map(line => `() => ${line}`).join(",\n  ");
  using dir = tempDir("aot-global-jest-in-messages", {
    "package.json": `{ "name": "p" }`,
    [name]: `const asks = [\n  ${asks},\n];\ntest("t", () => {\n  for (const ask of asks) {\n    try {\n      ask();\n      console.error("OUT nothing is thrown");\n    } catch (error) {\n      console.error("OUT", String(error));\n    }\n  }\n});\n`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { messages: stderr.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(["a.test.ts", "a.test.js", "a.test.cjs"])(
  "%s",
  async name => {
    const plain = await messagesOf(name, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.messages).toHaveLength(lines.length);
    expect(await messagesOf(name, ["--aot"])).toEqual(plain);
  },
  120_000,
);
