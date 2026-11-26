import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "./with-compiler";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const files = {
  "library/package.json": JSON.stringify({ name: "gaps", version: "1.2.3" }),
  "library/tsconfig.json": tsconfig,
  "library/src/gap.js": `const list = (...values) => values.join();
class List {
  constructor(...values) {
    this.text = list(...values);
  }
}
const row = { low: 1, high: 9 };
export function compare(low, value, high) {
  return [
    list(low < value, high > (value | 0)),
    list(low < value, 5, high > (value & 7), 6),
    list(row.low + 1 < value, row.high > (value | 0)),
    list(list(low < 2, value < high > (low | 0)), low < value, high > (value ^ 1)),
    new List(low < value, high > (value | 0)).text,
    [low < value, high > (value | 0)].join(),
    \`\${list(low < value, high > (value | 0))}\`,
    String(low < value > (value, 0)),
    String((low < value) | (high > (value & 7))),
    String((low < -1) | (high > (value | 8))),
    String((low < value) & (high > (value ^ 12))),
    String(low < value < high >> (value & 1)),
    String(low < value > [0].map(it => it)[0]),
    list((low = low + 1) < value, (high = high - 1) > (value | 0)),
  ].join(" ");
}
`,
  "library/src/gap.d.ts": `export declare function compare(low: number, value: number, high: number): string;\n`,
  "library/src/index.ts": `import { compare } from "./gap.js";
function both(one: boolean, other: boolean): boolean {
  return one && other;
}
export function isInside(value: number): boolean {
  const low: number = 1;
  const high: number = 9;
  return both((low < value), high > (value | 0));
}
export function rows(value: number): string {
  return compare(1, value, 9);
}
`,
  "app/tsconfig.json": tsconfig,
  "app/package.json": JSON.stringify({ name: "app", dependencies: { gaps: "1.2.3" } }),
  "app/app.ts": `import { isInside, rows } from "gaps";
for (const value of [0, 4, 12]) console.log(isInside(value), rows(value));
`,
};

const env = { ...bunEnv, NO_COLOR: "1" };

async function spawned(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("comparisons in a library", () => {
  test.each([[[]], [["--minify-whitespace", "--minify-syntax"]]])(
    "are the ones of its JavaScript in a program that installs it (%p)",
    async flags => {
      using dir = tempDir("aot-library-comparisons", files);
      const [library, app] = [join(String(dir), "library"), join(String(dir), "app")];
      expect(await spawned(library, bunExe(), "compile", "--library", ...flags, "src/index.ts")).toMatchObject({
        stderr: "",
        exitCode: 0,
      });
      expect(existsSync(join(library, "dist/index.aot.ts"))).toBe(true);
      cpSync(join(library, "dist"), join(app, "node_modules/gaps"), { recursive: true });
      const plain = await spawned(app, bunExe(), "app.ts");
      expect(plain).toMatchObject({ stderr: "", exitCode: 0 });
      expect(plain.stdout).toContain("true true,true ");
      expect(await spawned(app, bunExe(), "run", "--aot", "app.ts")).toEqual(plain);
      expect(await spawned(app, bunExe(), "compile", "./app.ts")).toMatchObject({ exitCode: 0 });
      expect(await spawned(app, join(app, isWindows ? "app.exe" : "app"))).toEqual(plain);
    },
  );
});
