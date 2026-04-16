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
