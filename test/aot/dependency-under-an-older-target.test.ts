import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a package that ships its TypeScript stays typed where only tsc's output for the application's older target would differ", async () => {
  using dir = tempDir("aot-dependency-older-target", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "ES2017", types: [] } }),
    "main.ts": `import { Named, Limited, Late, pick } from "ships-typescript";
declare const console: { log(...values: unknown[]): void };
console.log(Named.name, new Limited("seven").max, new Limited("seven").text, new Late(true).text, new Late(false).extra, pick(undefined));
`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `const limit = 3;
const fallback = "outer";
export class Named { static name = "a name of its own"; }
export class Limited { max = limit; text: string; constructor(limit: string) { this.text = limit; } }
export class Late extends Limited { extra = 1; constructor(flag: boolean) { if (flag) { super("yes"); } else { super("no"); } } }
export function pick(options?: { name?: string }, name = options?.name ?? fallback) { var fallback = 1; return name + ":" + fallback; }
`,
  });
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  const {
    stdout: printed,
    stderr: said,
    exitCode: built,
  } = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile], String(dir));
  expect(printed + said).not.toContain("ships-typescript");
  expect(built).toBe(0);
  const { stdout, exitCode } = await run([outfile], String(dir));
  expect({ stdout, exitCode }).toEqual({ stdout: "a name of its own 3 seven yes 1 outer:1\n", exitCode: 0 });
}, 120_000);
