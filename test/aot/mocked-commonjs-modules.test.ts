import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const library = {
  "lib.cjs": `
    exports.limit = 5;
    exports.helper = function () { return "real helper"; };
  `,
  "node_modules/fake-package/package.json": `{ "name": "fake-package", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/fake-package/index.js": `
    exports.connect = function () { return "a real connection"; };
    exports.version = "1.0.0";
  `,
  "node_modules/fake-package/index.d.ts": `
    export function connect(): string;
    export const version: string;
  `,
  "user.ts": `
    import { limit, helper } from "./lib.cjs";
    import { connect, version } from "fake-package";
    const required = require("./lib.cjs");
    export function all(): string { return [limit, helper(), required.limit, required.helper(), connect(), version].join(); }
  `,
};

const mocks = `
  mock.module("./lib.cjs", () => ({ limit: 6, helper: () => "mocked helper" }));
  mock.module("fake-package", () => ({ connect: () => "a mocked connection", version: "mocked" }));
`;

const cases: Record<string, { files: Record<string, string>; flags?: string[] }> = {
  "mocked after it is loaded": {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { all } from "./user";
        test("case", () => { console.log("see:", all()); ${mocks} console.log("see:", all()); });
      `,
    },
  },
  "mocked before it is loaded": {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        ${mocks}
        test("case", async () => { const { all } = await import("./user"); console.log("see:", all()); });
      `,
    },
  },
  "mocked by a preload": {
    flags: ["--preload", "./pre.ts"],
    files: {
      ...library,
      "pre.ts": `
        import { mock } from "bun:test";
        ${mocks}
      `,
      "main.test.ts": `
        import { test } from "bun:test";
        import { all } from "./user";
        test("case", () => { console.log("see:", all()); });
      `,
    },
  },
  "not mocked": {
    files: {
      ...library,
      "main.test.ts": `
        import { test } from "bun:test";
        import { all } from "./user";
        test("case", () => { console.log("see:", all()); });
      `,
    },
  },
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: a CommonJS module %s",
  async name => {
    const { files, flags = [] } = cases[name];
    using dir = tempDir("mocked-commonjs-modules", files);
    const plain = await seen(String(dir), ["test", ...flags, "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", ...flags, "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
