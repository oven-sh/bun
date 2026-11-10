// Generates a parse-heavy, execution-light shared module: one exported function
// whose BODY is ~2MB. Per-global work is one FunctionExecutable + one JSFunction;
// the 2MB body lives in the cached UnlinkedFunctionExecutable and never re-parses
// once CodeCache + the SourceProvider cache are warm. The body is never called,
// so evaluation cost is near-zero.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = 30;
const STMTS = 30_000; // ~2MB of source inside one function body
const root = import.meta.dir + "/suite";

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

let body = "";
for (let i = 0; i < STMTS; i++) {
  body += `  if (a === ${i}) { const x${i}: number = (a * ${i}) | 0; return x${i} + b.length; }\n`;
}
const big =
  `// Isolation guard: this module must evaluate in a fresh global per test file.
// If a runner loads it twice in the same global (no isolation), the second load
// sees the prior counter and throws — making the bench fail instead of silently
// measuring the wrong thing.
declare const globalThis: { __big_loaded?: number };
if (globalThis.__big_loaded !== undefined) {
  throw new Error("big.ts evaluated twice in the same global (isolation is not active)");
}
globalThis.__big_loaded = (globalThis.__big_loaded ?? 0) + 1;
export const LOAD_COUNT = globalThis.__big_loaded;
` + `export function big(a: number, b: string): number {\n${body}  return -1;\n}\nexport const MARKER = ${STMTS};\n`;
writeFileSync(`${root}/big.ts`, big);

for (let f = 0; f < FILES; f++) {
  writeFileSync(
    `${root}/t${String(f).padStart(2, "0")}.test.ts`,
    `import { big, MARKER, LOAD_COUNT } from "./big";
test("t${f}", () => {
  const seen = (globalThis as any).__isolate_bench_seen;
  if (seen !== undefined) {
    throw new Error(
      "\\n\\n" +
      "  ┌─────────────────────────────────────────────────────────────┐\\n" +
      "  │  This benchmark requires per-file isolation.                │\\n" +
      "  │                                                             │\\n" +
      "  │  t${String(f).padStart(2, "0")}.test.ts ran in the same global as t" + String(seen).padStart(2, "0") + ".test.ts.         │\\n" +
      "  │                                                             │\\n" +
      "  │  Run with:  bun test --isolate ./suite                      │\\n" +
      "  └─────────────────────────────────────────────────────────────┘\\n"
    );
  }
  (globalThis as any).__isolate_bench_seen = ${f};
  expect(LOAD_COUNT).toBe(1);
  expect(typeof big).toBe("function");
  expect(MARKER).toBe(${STMTS});
});
`,
  );
}

const bytes = Buffer.byteLength(big);
console.log(`wrote ${root}/big.ts (${(bytes / 1024 / 1024).toFixed(2)} MB, 1 function) + ${FILES} test files`);

// A second suite, for jest.resetModules(): every test imports one graph of small modules through src/index.ts.
const RESET_MODULES = 300;
const RESET_FILES = 100;
const RESET_TESTS = 3;
// Named "suite" so that bench/test/.gitignore covers it. Not inside ./suite, which `bun test ./isolate/suite` scans.
const resetRoot = import.meta.dir + "/reset/suite";

// The README runs the benchmark from inside resetRoot, so replace its folders and never remove resetRoot itself:
// a shell whose working directory was removed cannot run anything there, even after the directory is made again.
for (const dir of ["src", "tests", "tests-noreset"]) {
  rmSync(`${resetRoot}/${dir}`, { recursive: true, force: true });
  mkdirSync(`${resetRoot}/${dir}`, { recursive: true });
}

let imports = "";
const calls: string[] = [];
for (let m = 0; m < RESET_MODULES; m++) {
  writeFileSync(
    `${resetRoot}/src/m${m}.ts`,
    `export interface T${m} { id: number; name: string }
export const v${m}: number = ${m};
export function f${m}(x: number, t?: T${m}): number {
  return x + v${m} + (t ? t.id : 0);
}
`,
  );
  imports += `import { f${m} } from "./m${m}.ts";\n`;
  calls.push(`f${m}(x)`);
}
writeFileSync(
  `${resetRoot}/src/index.ts`,
  `${imports}export const sum = (x: number): number => ${calls.join(" + ")};\n`,
);

const sumOfModuleNumbers = (RESET_MODULES * (RESET_MODULES - 1)) / 2;
let tests = "";
for (let t = 1; t <= RESET_TESTS; t++) {
  tests += `test("t${t}", async () => {
  const { sum } = await import("../src/index.ts");
  expect(sum(${t})).toBe(${sumOfModuleNumbers + RESET_MODULES * t});
});
`;
}
const header = `import { beforeEach, expect, jest, test } from "bun:test";\n`;
const reset = `beforeEach(() => {\n  jest.resetModules();\n});\n`;
for (let f = 0; f < RESET_FILES; f++) {
  const name = `f${String(f).padStart(3, "0")}.test.ts`;
  writeFileSync(`${resetRoot}/tests/${name}`, header + reset + tests);
  writeFileSync(`${resetRoot}/tests-noreset/${name}`, header + tests);
}

writeFileSync(
  `${resetRoot}/preload-reset.ts`,
  `import { beforeAll, jest } from "bun:test";
beforeAll(() => {
  jest.resetModules();
});
`,
);

console.log(
  `wrote ${resetRoot}: ${RESET_MODULES} modules, 2 × ${RESET_FILES} files × ${RESET_TESTS} tests, preload-reset.ts`,
);
