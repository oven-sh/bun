import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const libraries = {
  strict: {
    stated: { strict: true },
    written: { strict: true },
    keeps: "const checksNull: ChecksNull = true;",
    source: `type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = true;
export function strict(name: string | undefined): string {
  return (name ?? "nobody") + " " + checksNull;
}
`,
  },
  "without-null-checks": {
    stated: { strict: true, strictNullChecks: false },
    written: { strict: true, strictNullChecks: false },
    keeps: "const checksNull: ChecksNull = false;",
    source: `type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = false;
let last: string = null;
export function withoutNullChecks(name: string): string {
  const before: string = last;
  last = name;
  return before + " " + checksNull;
}
`,
  },
  "with-dom": {
    stated: { strict: true, lib: ["es2022", "dom"] },
    written: { strict: true, lib: ["es2022", "dom"] },
    keeps: "const hasDocument: HasDocument = true;",
    source: `type HasDocument = typeof globalThis extends { document: unknown } ? true : false;
const hasDocument: HasDocument = true;
export function withDom(node: Pick<HTMLElement, "tagName">): string {
  return node.tagName + " " + hasDocument;
}
`,
  },
  "without-dom": {
    stated: { strict: true, lib: ["es2022"] },
    written: { strict: true, lib: ["es2022"] },
    keeps: "const hasDocument: HasDocument = false;",
    source: `type HasDocument = typeof globalThis extends { document: unknown } ? true : false;
const hasDocument: HasDocument = false;
interface HTMLElement {
  label: string;
}
export function withoutDom(node: HTMLElement): string {
  return node.label + " " + hasDocument;
}
`,
  },
  "with-checked-indexes": {
    stated: { strict: true, noUncheckedIndexedAccess: true },
    written: { strict: true, noUncheckedIndexedAccess: true },
    keeps: "const mayBeMissing: undefined extends typeof first ? true : false = true;",
    source: `export function withCheckedIndexes(names: string[]): string {
  const first = names[0];
  const mayBeMissing: undefined extends typeof first ? true : false = true;
  return first + " " + mayBeMissing;
}
`,
  },
};

const byHand = {
  "node_modules/by-hand/package.json": JSON.stringify({
    name: "by-hand",
    version: "1.0.0",
    type: "module",
    exports: { ".": { aot: "./index.aot.ts", default: "./index.js" } },
  }),
  "node_modules/by-hand/index.js": `const checksNull = true;
export function byHand(name) {
  return (name ?? "nobody") + " " + checksNull;
}
`,
  "node_modules/by-hand/index.aot.ts": `type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = true;
export function byHand(name: string | undefined): string {
  return (name ?? "nobody") + " " + checksNull;
}
`,
};

const app = `import { byHand } from "by-hand";
import { strict } from "strict";
import { withCheckedIndexes } from "with-checked-indexes";
import { withDom } from "with-dom";
import { withoutDom } from "without-dom";
import { withoutNullChecks } from "without-null-checks";
console.log(byHand(undefined), strict("Ada"), withCheckedIndexes([]), withDom({ tagName: "P" }));
console.log(withoutDom({ label: "a label" }), withoutNullChecks("first"), withoutNullChecks("second"));
`;
const printed = "nobody true Ada true undefined true P true\na label false null false first false\n";

const applications: Record<string, object | undefined> = {
  "has no tsconfig.json": undefined,
  "is strict, checks indexes and has no dom": {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    lib: ["esnext"],
  },
  "is not strict and has dom": { strict: false, lib: ["es2020", "dom"] },
};

const files: Record<string, string> = { ...byHand, "app.ts": app };
files["package.json"] = JSON.stringify({ name: "app", private: true, type: "module" });
for (const [name, { stated, source }] of Object.entries(libraries)) {
  files[`libraries/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0" });
  files[`libraries/${name}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", types: [], ...stated },
  });
  files[`libraries/${name}/src/index.ts`] = source;
}

/** Compiles app.ts: what the build warns of, and how many files under an "aot" condition it compiled with their types. */
async function compile(root: string) {
  const report = join(root, "report.json");
  const built = await spawned([bunExe(), "compile", "./app.ts", "--aot-report=" + report], root, env);
  const said = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /^(warn|error): /.test(line));
  return { said, exitCode: built.exitCode, aotFiles: readBuildReport(report).statistics.TypedVersionsUsed };
}

describe.concurrent("the file under a package's aot condition means what its package.json says", () => {
  test.each(Object.entries(applications))(
    "in an application that %s",
    (_, compilerOptions) =>
      slot(async () => {
        using dir = tempDir("aot-package-compiler-options", {
          ...files,
          ...(compilerOptions && { "tsconfig.json": JSON.stringify({ compilerOptions }) }),
        });
        const root = String(dir);
        for (const [name, { written, keeps }] of Object.entries(libraries)) {
          const library = join(root, "libraries", name);
          const built = await spawned([bunExe(), "compile", "--library", "src/index.ts"], library, env);
          expect({ name, stderr: built.stderr, exitCode: built.exitCode }).toEqual({ name, stderr: "", exitCode: 0 });
          expect(readdirSync(join(library, "dist")).sort()).toEqual([
            "index.aot.ts",
            "index.d.ts",
            "index.js",
            "package.json",
          ]);
          expect(JSON.parse(readFileSync(join(library, "dist/package.json"), "utf8")).compilerOptions).toEqual(written);
          expect(readFileSync(join(library, "dist/index.aot.ts"), "utf8")).toContain(keeps);
          cpSync(join(library, "dist"), join(root, "node_modules", name), { recursive: true });
        }
        expect(await compile(root)).toEqual({ said: [], exitCode: 0, aotFiles: 1 + Object.keys(libraries).length });
        const ran = await spawned([join(root, isWindows ? "app.exe" : "app")], root, env);
        const plain = await spawned([bunExe(), "app.ts"], root, env);
        expect({ compiled: ran.stdout, plain: plain.stdout }).toEqual({ compiled: printed, plain: printed });
      }),
    600_000,
  );

  test.each([
    ["says so", { strictNullChecks: false }, []],
    ["does not say so", undefined, [expect.stringContaining("TS100009: 'lenient' has 1 type error")]],
  ])(
    "a file that is written without null checks, in a package whose package.json %s",
    (_, compilerOptions, said) =>
      slot(async () => {
        using dir = tempDir("aot-package-compiler-options", {
          "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
          "app.ts": `import { after } from "lenient";\nconsole.log(after("first"), after("second"));\n`,
          "node_modules/lenient/package.json": JSON.stringify({
            name: "lenient",
            version: "1.0.0",
            type: "module",
            exports: { ".": { aot: "./index.aot.ts", default: "./index.js" } },
            compilerOptions,
          }),
          "node_modules/lenient/index.js": `let last = null;
export function after(name) {
  const before = last;
  last = name;
  return before;
}
`,
          "node_modules/lenient/index.aot.ts": `let last: string = null;
export function after(name: string): string {
  const before: string = last;
  last = name;
  return before;
}
`,
        });
        const root = String(dir);
        expect(await compile(root)).toEqual({ said, exitCode: 0, aotFiles: 1 - said.length });
        const ran = await spawned([join(root, isWindows ? "app.exe" : "app")], root, env);
        expect(ran.stdout).toBe("null first\n");
      }),
    600_000,
  );
});
