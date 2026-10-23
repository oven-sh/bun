// Under `bun test` a mock may put another value in the place of what a module exports. What a compiler may conclude from the initializer of an exported variable, that `N` is 5,
// does not hold for the value a mock supplies: under `bun test --aot` every function reads the mocked value, as under `bun test`.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const files = {
  "a.ts": `
    export const N: number = 5;
    export let counter: number = 1;
    export const KEY: string = "real";
    export const FLAG: boolean = true;
    const listed: number = 7;
    export { listed };
    export function own(): number { return N + 1; }
    export function helper(): string { return "real helper"; }
    export function ownReads(): string { return [N, counter, KEY, FLAG, N === 5 ? "five" : "other", "<" + KEY + ">", helper()].join(); }
  `,
  "b.ts": `
    import { N, counter, listed, KEY, FLAG } from "./a";
    export function key(): string { return KEY === "real" ? "the real one" : "another: " + KEY; }
    export function flag(): string { if (FLAG) return "on"; return FLAG ? "on after all" : "off"; }
    export function texts(): string { return \`<\${KEY}|\${N}|\${FLAG}>\` + listed + "/" + KEY.length; }
    export function chosen(): string { switch (KEY) { case "real": return "case real"; case "mocked": return "case mocked"; default: return "no case"; } }
    export function read(): number { return N; }
    export function sum(): number { return N + counter + listed; }
    export function decide(): string { return N === 5 ? "five" : N < 5 ? "less" : "more"; }
    export function index(): string { return ["a", "b", "c", "d", "e", "f", "g"][N] ?? "none"; }
  `,
  "main.test.ts": `
    import { mock, test } from "bun:test";
    import { read, sum, decide, index, key, flag, texts, chosen } from "./b";
    import * as a from "./a";
    const { ownReads } = a;
    mock.module("./a", () => ({ N: 6, counter: 2.5, listed: -1, own: () => 0, KEY: "mocked", FLAG: false, helper: () => "mocked helper", ownReads }));
    test("functions read mocked numbers", () => {
      console.log("see:", read(), sum(), decide(), index(), key(), flag(), texts(), chosen(), ownReads());
    });
  `,
  "unmocked.test.ts": `
    import { test } from "bun:test";
    import { read, sum, decide, index, key, flag, texts, chosen } from "./b";
    import { own, ownReads } from "./a";
    test("functions read the numbers as they are written", () => {
      console.log("see:", read(), sum(), decide(), index(), own(), key(), flag(), texts(), chosen(), ownReads());
    });
  `,
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(["main.test.ts", "unmocked.test.ts"])(
  "bun test --aot %s prints what bun test prints: numbers, strings and booleans that a mock supplies",
  async file => {
    using dir = tempDir("mocked-numbers", files);
    const plain = await seen(String(dir), ["test", "./" + file]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBe(1);
    expect(await seen(String(dir), ["test", "--aot", "./" + file])).toEqual(plain);
  },
  120_000,
);
