import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// mock.module() over a loaded module, then vi.doMock() of the same module. At the second mock `bun test` lets go of whoever was linked to the first: the next load of
// such a user runs its body again and links it to what stands then. Compiled code has one instance of the user and runs no body again: the user reads as the fresh one.
// The user that the test file holds since the top was not loaded anew, and keeps the module.
const user = `import { flag } from "./dep.js";
import * as ns from "./dep.js";
export const values = () => [flag, ns.flag, ns["fl" + "ag"], Object.keys(ns).join("+")].join();
`;
const files = (load: string) => ({
  "package.json": `{ "type": "module" }`,
  "dep.js": `export const flag = "real";\n`,
  "top.js": user,
  "late.js": user,
  "a.test.js": `import { mock, test, vi } from "bun:test";
import * as top from "./top.js";
// The load of the module by name comes first: behind it no mock waits for its factory, and a settled answer of require() is at hand.
const look = async step => console.log("seen:", step, (await import("./dep.js")).flag, (${load}).values(), top.values());
test("t", async () => {
  await look("start");
  mock.module("./dep.js", () => ({ flag: "module" }));
  await look("mock.module()");
  vi.doMock("./dep.js", () => ({ flag: "mock", added: 1 }));
  await look("vi.doMock()");
  mock.module("./dep.js", () => ({ flag: "again" }));
  await look("mock.module() again");
});
`,
});

test.each([
  ["imported", `await import("./late.js")`],
  ["required", `import.meta.require("./late.js")`],
])(
  "a user that is %s anew behind the second mock reads it",
  async (_, load) => {
    using dir = tempDir("aot-mock-anew", files(load));
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const failed = stderr.split("\n").filter(line => /^\(fail\)|^panic|^error: /.test(line));
      return { lines: stdout.split("\n").filter(line => line.startsWith("seen: ")), failed, exitCode };
    };
    const plain = await seenWith();
    expect(plain).toEqual({
      lines: [
        "seen: start real real,real,real,flag real,real,real,flag",
        "seen: mock.module() module module,module,module,flag module,module,module,flag",
        "seen: vi.doMock() mock mock,mock,mock,flag+added real,real,real,flag",
        "seen: mock.module() again again again,again,again,flag real,real,real,flag",
      ],
      failed: [],
      exitCode: 0,
    });
    expect(await seenWith("--aot")).toEqual(plain);
  },
  120_000,
);
