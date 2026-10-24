import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const library = {
  "source.ts": `
    export const limit: number = 5;
    export function helper(): string { return "real helper"; }
    export { limit as bound };
  `,
  "barrel.ts": `export { limit, helper } from "./source";`,
  "star.ts": `export * from "./source";`,
  "outer.ts": `export * from "./barrel";`,
  "user.ts": `
    import { limit, helper } from "./barrel";
    import { limit as starred, helper as starredHelper } from "./star";
    import { limit as outer, helper as outerHelper } from "./outer";
    import { limit as direct, helper as directHelper, bound } from "./source";
    import * as barrel from "./barrel";
    import * as source from "./source";
    export async function all(): Promise<string> {
      return [
        limit, helper(), starred, starredHelper(), outer, outerHelper(), direct, directHelper(), bound,
        barrel.limit, barrel.helper(), ({ ...barrel }).limit, (await import("./barrel")).limit, require("./barrel").limit,
        source.limit, source.helper(), (await import("./source")).limit,
      ].join();
    }
  `,
};

const mocks: Record<string, string> = {
  "a barrel": `mock.module("./barrel", () => ({ limit: 6, helper: () => "mocked helper" }));`,
  "a barrel that exports all of a module": `mock.module("./star", () => ({ limit: 6, helper: () => "mocked helper", bound: 7 }));`,
  "a barrel of a barrel": `mock.module("./outer", () => ({ limit: 6, helper: () => "mocked helper" }));`,
  "a module that exports one binding under two names": `mock.module("./source", () => ({ limit: 6, helper: () => "mocked helper", bound: 7 }));`,
};

const cases: Record<string, { files: Record<string, string>; flags?: string[] }> = {};
for (const [name, lay] of Object.entries(mocks)) {
  cases[name + ", mocked before it is loaded"] = {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        ${lay}
        test("case", async () => { const { all } = await import("./user"); console.log("see:", await all()); });
      `,
    },
  };
  cases[name + ", mocked by a preload"] = {
    flags: ["--preload", "./pre.ts"],
    files: {
      ...library,
      "pre.ts": `
        import { mock } from "bun:test";
        ${lay}
      `,
      "main.test.ts": `
        import { test } from "bun:test";
        import { all } from "./user";
        test("case", async () => { console.log("see:", await all()); });
      `,
    },
  };
  cases[name + ", mocked after it is loaded"] = {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { all } from "./user";
        test("case", async () => { console.log("see:", await all()); ${lay} console.log("see:", await all()); });
      `,
    },
  };
}

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    const { files, flags = [] } = cases[name];
    using dir = tempDir("mocked-barrels", files);
    const plain = await seen(String(dir), ["test", ...flags, "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", ...flags, "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
