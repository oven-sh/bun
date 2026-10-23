import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const files = {
  "a.ts": `
    export let count: number = 5;
    export let label: string = "real";
    export function bump(): number { count++; return count; }
    export function set(n: number, text: string): void { count = n; label = text; }
  `,
  "user.ts": `
    import { count, label } from "./a";
    export function read(): string { return count + " " + label; }
  `,
  "main.test.ts": `
    import { mock, test } from "bun:test";
    import * as a from "./a";
    import { read } from "./user";
    const { bump, set } = a;
    test("case", () => {
      console.log("see:", read());
      mock.module("./a", () => ({ count: 6, label: "mocked", bump, set }));
      console.log("see:", read(), bump(), read());
      set(40, "set");
      console.log("see:", read(), bump(), read());
    });
  `,
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test("bun test --aot: what a module stores to a binding of its own after a mock is what everyone reads", async () => {
  using dir = tempDir("mocked-reassigned-bindings", files);
  const plain = await seen(String(dir), ["test", "./main.test.ts"]);
  expect(plain.exitCode).toBe(0);
  expect(plain.seen.length).toBe(3);
  expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
}, 120_000);
