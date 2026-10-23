import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const cases: Record<string, { files: Record<string, string>; flags?: string[] }> = {
  "a static method of a mocked class": {
    files: {
      "a.ts": `export class Store { static open(): string { return "the real store"; } read(): string { return "a real read"; } }`,
      "user.ts": `
        import { Store } from "./a";
        export function open(): string { return Store.open(); }
        export function read(): string { return new Store().read(); }
      `,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { open, read } from "./user";
        mock.module("./a", () => ({ Store: class Store { static open(): string { return "the mocked store"; } read(): string { return "a mocked read"; } } }));
        test("case", () => { console.log("see:", open(), "|", read()); });
      `,
    },
  },
  "the members of a mocked enum": {
    files: {
      "a.ts": `
        export enum Level { Low = 1, High = 2 }
        export enum Word { Yes = "yes", No = "no" }
        export function own(): string { return [Level.Low, Word.Yes].join(); }
      `,
      "user.ts": `
        import { Level, Word } from "./a";
        function chosen(level: Level): string { switch (level) { case Level.Low: return "low"; case Level.High: return "high"; default: return "neither"; } }
        export function levels(): string { return [Level.Low, Level.High, Level[Level.Low], Level.Low === 1, Word.Yes, chosen(1 as Level), chosen(10 as Level)].join(); }
      `,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { levels } from "./user";
        import { own } from "./a";
        mock.module("./a", () => ({ Level: { Low: 10, High: 20, 10: "Low", 20: "High" }, Word: { Yes: "ja", No: "nein" }, own }));
        test("case", () => { console.log("see:", levels(), own()); });
      `,
    },
  },
  "a function that a preload mocks, kept in a constant": {
    flags: ["--preload", "./pre.ts"],
    files: {
      "a.ts": `export function price(n: number): number { return n + 1; }`,
      "user.ts": `
        import { price } from "./a";
        const kept = price;
        export function viaConstant(n: number): number { return kept(n); }
        export function viaImport(n: number): number { return price(n); }
        export function viaSpread(n: number): number { return price(...([n] as [number])); }
      `,
      "pre.ts": `
        import { mock } from "bun:test";
        mock.module("./a", () => ({ price: (n: number) => n + 100 }));
      `,
      "main.test.ts": `
        import { test } from "bun:test";
        import { viaConstant, viaImport, viaSpread } from "./user";
        test("case", () => { console.log("see:", viaConstant(1), viaImport(1), viaSpread(1)); });
      `,
    },
  },
  "a class that a preload mocks, extended": {
    flags: ["--preload", "./pre.ts"],
    files: {
      "a.ts": `export class Base { name(): string { return "the real base"; } }`,
      "user.ts": `
        import { Base } from "./a";
        export class Derived extends Base {}
        export function parentIsTheImport(): boolean { return Object.getPrototypeOf(Derived) === Base; }
      `,
      "pre.ts": `
        import { mock } from "bun:test";
        mock.module("./a", () => ({ Base: class Base { name(): string { return "the mocked base"; } } }));
      `,
      "main.test.ts": `
        import { test } from "bun:test";
        import { Derived, parentIsTheImport } from "./user";
        test("case", () => { console.log("see:", new Derived().name(), parentIsTheImport()); });
      `,
    },
  },
  "constants without annotations": {
    files: {
      "a.ts": `
        export const TIMEOUT = 5000;
        export const VERBOSE = true;
        export const NAME = "real";
      `,
      "user.ts": `
        import { TIMEOUT, VERBOSE, NAME } from "./a";
        export function settings(): string { return [TIMEOUT, TIMEOUT + 1, TIMEOUT === 5000, VERBOSE ? "loud" : "quiet", NAME].join(); }
      `,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { settings } from "./user";
        mock.module("./a", () => ({ TIMEOUT: 10, VERBOSE: false, NAME: "mocked" }));
        test("case", () => { console.log("see:", settings()); });
      `,
    },
  },
  "a constant read from the object that stands for its module": {
    files: {
      "a.ts": `
        export const N: number = 5;
        export function f(): string { return "real f"; }
      `,
      "user.ts": `
        import * as ns from "./a";
        export async function all(): Promise<string> {
          const required = require("./a") as typeof import("./a");
          return [ns["N"], (ns as any)[["N"][0]], ({ ...ns }).N, (await import("./a")).N, required.N, required.f()].join();
        }
      `,
      "main.test.ts": `
        import { mock, test } from "bun:test";
        import { all } from "./user";
        mock.module("./a", () => ({ N: 6, f: () => "mocked f" }));
        test("case", async () => { console.log("see:", await all()); });
      `,
    },
  },
};

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    const { files, flags = [] } = cases[name];
    using dir = tempDir("mocked-exports", files);
    const plain = await seen(String(dir), ["test", ...flags, "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBe(1);
    expect(await seen(String(dir), ["test", "--aot", ...flags, "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
