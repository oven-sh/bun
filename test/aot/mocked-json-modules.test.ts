import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const library = {
  "tsconfig.json": `{ "compilerOptions": { "resolveJsonModule": true, "strict": true, "module": "esnext", "moduleResolution": "bundler" } }`,
  "data.json": `{ "url": "real", "retries": 1 }`,
  "other.json": `{ "name": "not mocked" }`,
  "user.ts": `
    import data from "./data.json";
    import { url } from "./data.json";
    import * as whole from "./data.json";
    import other from "./other.json";
    export function all(): string {
      return [data.url, data.retries + 1, url, whole.url, JSON.stringify(data), require("./data.json").url, other.name].join();
    }
  `,
};

const lay = `mock.module("./data.json", () => ({ default: { url: "mocked", retries: 2 }, url: "mocked", retries: 2 }));`;

const cases: Record<string, { files: Record<string, string>; flags?: string[] }> = {
  "after it is loaded": {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { all } from "./user";
        test("case", () => { console.log("see:", all()); ${lay} console.log("see:", all()); });
      `,
    },
  },
  "before it is loaded": {
    files: {
      ...library,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        ${lay}
        test("case", async () => { const { all } = await import("./user"); console.log("see:", all()); });
      `,
    },
  },
  "by a preload": {
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
  "bun test --aot prints what bun test prints: a JSON module mocked %s",
  async name => {
    const { files, flags = [] } = cases[name];
    using dir = tempDir("mocked-json-modules", files);
    const plain = await seen(String(dir), ["test", ...flags, "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", ...flags, "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
