import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { test } from "../supported";

raiseDefaultTimeout(120_000);

// The original of a mocked module is the file once more, as a second instance: `bun test` loads it under a key of its own. A compiled run loads it from disk.
const files = {
  "package.json": `{ "name": "mock-import-original" }`,
  "src/real.ts": `console.error("SEEN real runs");
export const kept = "kept";
export const replaced = "real";
export function twice(n: number) { return n * 2; }`,
  "src/user.ts": `import { kept, replaced, twice } from "./real";
export const seen = () => [kept, replaced, twice(2)].join();`,
  // An original that imports a file of the program: the copy from disk links to the compiled file.
  "src/below.ts": `export const below = "below";`,
  "src/deep.ts": `import { below } from "./below";
console.error("SEEN real runs");
export const kept = "kept " + below;
export const replaced = "real";
export function twice(n: number) { return n * 2; }`,
  "src/user-of-deep.ts": `import { kept, replaced, twice } from "./deep";
export const seen = () => [kept, replaced, twice(2)].join();`,
  "deep-outside.test.ts": `
import { mock, test, vi } from "bun:test";
test("vi.importActual() in a test, of a file that imports another", async () => {
  mock.module("./src/deep", () => ({ kept: "k", replaced: "mocked", twice: (n: number) => n }));
  const { seen } = await import("./src/user-of-deep");
  const real = await vi.importActual<typeof import("./src/deep")>("./src/deep");
  console.error("SEEN deep outside", seen(), real.kept, real.replaced, real.twice(2));
});`,
  "deep-mentioned.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user-of-deep";
vi.mock("./src/deep", async () => ({ ...(await vi.importActual<typeof import("./src/deep")>("./src/deep")), replaced: "mocked" }));
test("vi.importActual() in the factory, of a file that imports another", () => console.error("SEEN deep mentioned", seen()));`,
  "deep-automock.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user-of-deep";
import * as deep from "./src/deep";
vi.mock("./src/deep");
test("a mock without a factory, of a file that imports another", () => console.error("SEEN deep automock", seen(), typeof deep.twice, vi.isMockFunction(deep.twice), Object.keys(deep).join()));`,
  // The original calls functions of a compiled file, which compiled code calls without reading a variable, and hands them what no compiled code does.
  "src/tools.ts": `export function twice(n: any) { return n * 2; }
export function first(o: any) { return o.a; }`,
  "src/calls.ts": `import { first, twice } from "./tools";
console.error("SEEN real runs");
export const viaTwice = (n: any) => twice(n);
export const viaFirst = (o: any) => first(o);
export const own = twice(2) + first({ a: 1 });`,
  "src/user-of-calls.ts": `import { own } from "./calls";
export const seen = () => own;`,
  "calls-outside.test.ts": `
import { mock, test, vi } from "bun:test";
test("the original calls functions of a compiled file", async () => {
  mock.module("./src/calls", () => ({ own: "mocked" }));
  const { seen } = await import("./src/user-of-calls");
  const real = await vi.importActual<typeof import("./src/calls")>("./src/calls");
  console.error("SEEN calls outside", seen(), real.own, real.viaTwice("7"), real.viaTwice(2.5), real.viaFirst({ z: 0, a: "deep" }), real.viaFirst("text"));
});`,
  "parameter.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user";
vi.mock("./src/real", async importOriginal => ({ ...(await importOriginal<typeof import("./src/real")>()), replaced: "mocked" }));
test("the factory's parameter", () => console.error("SEEN parameter", seen()));`,
  "mentioned.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user";
vi.mock("./src/real", async () => ({ ...(await vi.importActual<typeof import("./src/real")>("./src/real")), replaced: "mocked" }));
test("vi.importActual() in the factory", () => console.error("SEEN mentioned", seen()));`,
  "required.test.ts": `
import { test, jest } from "bun:test";
import { seen } from "./src/user";
jest.mock("./src/real", () => ({ ...jest.requireActual("./src/real"), replaced: "mocked" }));
test("jest.requireActual() in the factory", () => console.error("SEEN required", seen()));`,
  "outside.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user";
vi.mock("./src/real", () => ({ kept: "k", replaced: "mocked", twice: (n: number) => n }));
test("vi.importActual() in a test", async () => {
  const real = await vi.importActual<typeof import("./src/real")>("./src/real");
  console.error("SEEN outside", seen(), real.replaced, real.twice(2), Object.keys(real).join());
});`,
  "automock.test.ts": `
import { test, vi } from "bun:test";
import { seen } from "./src/user";
import * as real from "./src/real";
vi.mock("./src/real");
test("a mock without a factory", () => console.error("SEEN automock", seen(), typeof real.twice, vi.isMockFunction(real.twice), Object.keys(real).join()));`,
};

/**
 * Every case builds the project twice, once in layers: under a sanitizer over a minute of processor time.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function originalOfAMockedModule(part: number, of: number) {
  const names = Object.keys(files).filter(name => name.endsWith(".test.ts"));
  test.each(names.filter((_, index) => index % of === part))("%s", async name => {
    using dir = tempDir("mock-import-original", files);
    const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./" + name], String(dir), {
        ...bunEnv,
        ...env,
      });
      return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
    };
    const [plain, oneProgram, layers] = await Promise.all([
      seenWith({}),
      seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot"),
      seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot"),
    ]);
    expect(plain.seen).toContain("SEEN real runs");
    expect(plain.seen.length).toBe(2);
    expect(plain.exitCode).toBe(0);
    expect(oneProgram).toEqual(plain);
    expect(layers).toEqual(plain);
  });
}
