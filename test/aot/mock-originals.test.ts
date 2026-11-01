// The original of a file beside its mock is the file once more, from disk: a copy that the build has not compiled. Where one may run, flow lets `globalThis` escape and enters the
// loader of the host, and a program as closed as a small server has a tenth of its functions compiled otherwise than in an executable. So the build asks whether anything in the run
// may ask for an original. `mock.module(path, () => ..)` with a factory that is written out and takes nothing doesn't. The list of those who do has to be whole:
// each form here runs as under `bun test`, and the original imports a name that compiled code only calls, which is trimmed where flow doesn't know of the copy.
// What the build can't read counts as asking. Its log names the file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const mocked = `({ four: () => -4, name: "mocked" })`;
const show = (original: string) => `console.log("ORIGINAL", ${original}.name, ${original}.four());`;

// TODO: eight forms answer otherwise than `bun test` with or without any of this. Of those only the build's answer is held.
const answersOtherwise = new Set([
  "vi.doMock() in a test",
  "vi.importActual() in the factory",
  "the parameter of a factory",
  "a rest parameter of a factory",
  "the arguments of a factory",
  "a factory that is handed in",
  "vi.doUnmock() ahead of a load",
  "jest.dontMock() ahead of a load",
]);

const forms: [name: string, head: string, body: string, asks: boolean][] = [
  ["mock.module() with a factory", `mock.module("./src/calls", () => ${mocked});`, ``, false],
  ["vi.mock() with a factory", `vi.mock("./src/calls", () => ${mocked});`, ``, false],
  ["jest.mock() with a factory", `jest.mock("./src/calls", () => ${mocked});`, ``, false],
  ["vi.doMock() in a test", ``, `vi.doMock("./src/calls", () => ${mocked});`, false],
  [
    "what has nothing to do with modules",
    `vi.mock("./src/calls", () => ${mocked});`,
    `const spy = vi.fn(() => 1); vi.spyOn(console, "debug"); jest.clearAllMocks(); vi.restoreAllMocks(); mock.restore(); console.log(spy(), typeof vi.importActual, typeof jest.requireActual);`,
    false,
  ],
  [
    "vi.importActual() in a test",
    `vi.mock("./src/calls", () => ${mocked});`,
    show(`(await vi.importActual<any>("./src/calls"))`),
    true,
  ],
  [
    "vi.importActual() in the factory",
    `vi.mock("./src/calls", async () => ({ ...(await vi.importActual<any>("./src/calls")), name: "mocked" }));`,
    ``,
    true,
  ],
  [
    "jest.requireActual() in the factory",
    `jest.mock("./src/calls", () => ({ ...jest.requireActual("./src/calls"), name: "mocked" }));`,
    ``,
    true,
  ],
  [
    "jest.requireActual() in a test",
    `jest.mock("./src/calls", () => ${mocked});`,
    show(`jest.requireActual("./src/calls")`),
    true,
  ],
  [
    "vi.importMock()",
    `vi.mock("./src/calls", () => ${mocked});`,
    `console.log(Object.keys(await vi.importMock<any>("./src/calls")).sort().join());`,
    true,
  ],
  [
    "jest.requireMock()",
    `jest.mock("./src/calls", () => ${mocked});`,
    `console.log(Object.keys(jest.requireMock("./src/calls")).sort().join());`,
    true,
  ],
  [
    "jest.createMockFromModule()",
    `jest.mock("./src/calls", () => ${mocked});`,
    `console.log(Object.keys(jest.createMockFromModule("./src/calls") as any).sort().join());`,
    true,
  ],
  [
    "the parameter of a factory",
    `vi.mock("./src/calls", async (importOriginal: any) => ({ ...(await importOriginal()), name: "mocked" }));`,
    ``,
    true,
  ],
  [
    "a rest parameter of a factory",
    `vi.mock("./src/calls", async (...given: any[]) => ({ ...(await given[0]()), name: "mocked" }));`,
    ``,
    true,
  ],
  [
    "the arguments of a factory",
    `vi.mock("./src/calls", async function () { return { ...(await arguments[0]()), name: "mocked" }; });`,
    ``,
    true,
  ],
  [
    "the word in a comment of the factory",
    `vi.mock("./src/calls", () => { /* no importOriginal needed */ return ${mocked}; });`,
    ``,
    true,
  ],
  [
    "the word in a string of the factory",
    `jest.mock("./src/calls", () => ({ four: () => -4, name: "requireActual" }));`,
    ``,
    true,
  ],
  ["a mock without a factory", `vi.mock("./src/calls");`, ``, true],
  ["{ spy: true }", `vi.mock("./src/calls", { spy: true } as any);`, ``, true],
  [
    "a factory that is handed in",
    `const factory = vi.hoisted(() => async (importOriginal: any) => ({ ...(await importOriginal()), name: "mocked" })); vi.mock("./src/calls", factory);`,
    ``,
    true,
  ],
  [
    "the name taken off vi",
    `vi.mock("./src/calls", () => ${mocked});`,
    `const { importActual } = vi; ${show(`(await importActual<any>("./src/calls"))`)}`,
    true,
  ],
  [
    "the name under a key",
    `vi.mock("./src/calls", () => ${mocked});`,
    show(`(await (vi as any)["importActual"]("./src/calls"))`),
    true,
  ],
  [
    "vi under another name",
    `vi.mock("./src/calls", () => ${mocked});`,
    `const other = vi; ${show(`(await other.importActual<any>("./src/calls"))`)}`,
    true,
  ],
  [
    "vi handed to a function",
    `vi.mock("./src/calls", () => ${mocked});`,
    `const ask = (given: typeof vi) => given.importActual<any>("./src/calls"); ${show(`(await ask(vi))`)}`,
    true,
  ],
  [
    "the runner as a namespace",
    `import * as runner from "bun:test"; vi.mock("./src/calls", () => ${mocked});`,
    show(`(await runner.vi.importActual<any>("./src/calls"))`),
    true,
  ],
  [
    "a helper asks",
    `import { actual } from "./helper"; vi.mock("./src/calls", () => ${mocked});`,
    show(`(await actual())`),
    true,
  ],
  [
    "vi.doUnmock() ahead of a load",
    `vi.mock("./src/calls", () => ${mocked});`,
    `vi.doUnmock("./src/calls"); ${show(`(await import("./src/calls"))`)}`,
    true,
  ],
  [
    "jest.dontMock() ahead of a load",
    `jest.mock("./src/calls", () => ${mocked});`,
    `jest.dontMock("./src/calls"); ${show(`require("./src/calls")`)}`,
    true,
  ],
];

for (const [name, head, body, asks] of forms) {
  test.concurrent(`${name}: ${asks ? "may ask for the original" : "asks for nothing"}`, async () => {
    using dir = tempDir("mock-originals", {
      "package.json": `{}`,
      "src/tools.ts": `export const twice = (n: number) => n * 2;`,
      "src/calls.ts": `import { twice } from "./tools"; export const four = () => twice(2); export const name: string = "real";`,
      "src/user.ts": `import { four, name } from "./calls"; export const seen = () => name + " " + four();`,
      "helper.ts": `import { vi } from "bun:test"; export const actual = () => vi.importActual<any>("./src/calls");`,
      "a.test.ts": `import { test, mock, vi, jest } from "bun:test";\n${head}\nimport { seen } from "./src/user";\ntest("t", async () => { ${body} console.log("SEEN", seen()); });\n`,
    });
    const printed = ({ stdout, exitCode }: { stdout: string; exitCode: number | null }) => ({
      lines: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
      exitCode,
    });
    const plain = printed(await run([bunExe(), "test"], String(dir), bunEnv));
    expect(plain.lines.some(line => line.startsWith("SEEN "))).toBe(true);
    const compiled = await run([bunExe(), "test", "--aot"], String(dir), {
      ...bunEnv,
      [buildEnvironment.logsPhaseTimes]: "1",
    });
    const answer = answersOtherwise.has(name) ? plain : printed(compiled);
    expect({ ...answer, asks: compiled.stderr.includes("the original beside a mock may run") }).toEqual({
      ...plain,
      asks,
    });
  });
}
