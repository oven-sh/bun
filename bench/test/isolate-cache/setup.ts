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
const big = `export function big(a: number, b: string): number {\n${body}  return -1;\n}\nexport const MARKER = ${STMTS};\n`;
writeFileSync(`${root}/big.ts`, big);

for (let f = 0; f < FILES; f++) {
  writeFileSync(
    `${root}/t${String(f).padStart(2, "0")}.test.ts`,
    `import { big, MARKER } from "./big";
test("t${f}", () => {
  expect(typeof big).toBe("function");
  expect(MARKER).toBe(${STMTS});
});
`,
  );
}

const bytes = Buffer.byteLength(big);
console.log(`wrote ${root}/big.ts (${(bytes / 1024 / 1024).toFixed(2)} MB, 1 function) + ${FILES} test files`);
