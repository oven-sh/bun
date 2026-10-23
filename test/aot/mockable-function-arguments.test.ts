import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const files = {
  "budget/grace.ts": `
    export interface Limits { waitMs: number }
    export const DEFAULT_WAIT_MS: Limits["waitMs"] = 1_000;
  `,
  "budget/create.ts": `export function create(ms: number): { ms: number } { return { ms }; }`,
  "budget/index.ts": `
    export * from "./grace";
    export * from "./create";
    export * as default from ".";
  `,
  "next.ts": `
    export interface Caught { error: Readonly<{ kind: string; message?: string; budget: number }>; called: boolean }
    export function hookNext<E extends string>(options: { event: E; budget: { ms: number }; caught?: Caught }): { event: E } {
      return { event: options.event, ...(options as object) } as { event: E };
    }
  `,
  "run.ts": `
    import Budget from "./budget";
    import { hookNext } from "./next";
    import type { Caught } from "./next";
    export async function run<E extends string>(event: E, kind: string, message: string | undefined, called: boolean): Promise<string> {
      const grace = Budget.create(Budget.DEFAULT_WAIT_MS);
      const next = hookNext({
        event,
        budget: grace,
        caught: {
          error: Object.freeze({
            kind,
            ...(message === undefined ? {} : { message }),
            budget: Budget.DEFAULT_WAIT_MS,
          }),
          called,
        },
      }) as { event: E } & Caught;
      return JSON.stringify(next);
    }
  `,
  "main.test.ts": `
    import { mock, spyOn, test } from "bun:test";
    import Budget from "./budget";
    import * as nextModule from "./next";
    import { run } from "./run";
    test("case", async () => {
      console.log("see:", await run("e", "a", undefined, true), await run("e", "b", "m", false));
      const create = spyOn(Budget, "create").mockReturnValue({ ms: 7 });
      const hookNext = spyOn(nextModule, "hookNext");
      console.log("see:", await run("e", "a", undefined, true), create.mock.calls.length, Object.isFrozen((hookNext.mock.calls[0][0] as any).caught.error));
      mock.restore();
      console.log("see:", await run("e", "a", "m", true));
    });
  `,
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test("bun test --aot: a frozen literal with a spread is handed to a function that a test spies on", async () => {
  using dir = tempDir("mockable-function-arguments", files);
  const plain = await seen(String(dir), ["test", "./main.test.ts"]);
  expect(plain.exitCode).toBe(0);
  expect(plain.seen.length).toBe(3);
  expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
}, 120_000);
