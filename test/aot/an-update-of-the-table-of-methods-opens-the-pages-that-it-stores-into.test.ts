// Compiled code calls a method that several classes declare through a table of the instance. The table is read-only. Where a program replaces such a method, the run time
// opens the table, stores the entries that stood on the method, and closes it. It opened the whole table for one entry of four bytes: 52 pages in a large application.
// It opens the pages that hold the entries it stores. The run time counts each page that it opens.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

function pageSize(): number {
  if (!isLinux) return isMacOS && process.arch === "arm64" ? 16384 : 4096;
  // Pairs of u64: a type, then its value.
  const auxiliaryVector = readFileSync("/proc/self/auxv");
  const AT_PAGESZ = 6n;
  for (let at = 0; at + 16 <= auxiliaryVector.length; at += 16) {
    if (auxiliaryVector.readBigUInt64LE(at) === AT_PAGESZ) return Number(auxiliaryVector.readBigUInt64LE(at + 8));
  }
  throw new Error("no AT_PAGESZ");
}

const numbered = (count: number, text: (number: number) => string, between = "\n") =>
  Array.from({ length: count }, (nothing, number) => text(number)).join(between);

/** A base, a class that declares each of its methods anew, and heirs that declare nothing. The table has an entry for each class under each method; those of one method lie side by side. */
const program = (heirs: number, methods: number, deed: string) => `class Base {
  weight = 1;
${numbered(methods, j => `  m${j}(k: number): number { return this.weight + k + ${j}; }`)}
}
class Other extends Base {
${numbered(methods, j => `  m${j}(k: number): number { return this.weight * 2 + k + ${j}; }`)}
}
${numbered(heirs, i => `class Heir${i} extends Base {}`)}
const all: Base[] = [new Base(), new Other(), ${numbered(heirs, i => `new Heir${i}()`, ", ")}];
function measure(): number {
  let sum = 0;
  for (const one of all) sum += ${numbered(methods, j => `one.m${j}(1)`, " + ")};
  return sum;
}
console.log(measure());
${deed}
console.log(measure());
`;

async function pagesOpenedBy(text: string) {
  using dir = tempDir("table-of-methods", { "program.ts": text });
  const cwd = String(dir);
  const plain = await run([bunExe(), "program.ts"], cwd);
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const built = await run([bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counts = join(cwd, "counts");
  expect(await run([join(cwd, "program")], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts })).toEqual(plain);
  return readFileSync(counts, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(([, name]) => name === "counter:MethodTablePagesMadeWritable")
    .map(([count]) => Number(count));
}

test("a method that is replaced on one class opens one page of a table of many", async () => {
  const deed = `(Heir150.prototype as any).m0 = function () { return 1000000; };`;
  expect(await pagesOpenedBy(program(300, 32, deed))).toEqual([1]);
});

test("a method that is replaced above thousands of heirs opens every page that holds an entry of it", async () => {
  // 4,202 entries of four bytes lie side by side.
  const [pages] = await pagesOpenedBy(
    program(4200, 1, `(Base.prototype as any).m0 = function () { return 1000000; };`),
  );
  expect(pages).toBeGreaterThanOrEqual(Math.ceil((4202 * 4) / pageSize()));
});
