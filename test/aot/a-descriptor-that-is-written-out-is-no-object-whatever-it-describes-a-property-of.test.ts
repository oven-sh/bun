import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfObjects = 300;
const numbers = Array.from({ length: numberOfObjects }, (_, index) => index);

// Nothing is known of what a text that is read at run time holds, so nothing says that the first argument of Object.defineProperty is an object. Each statement runs once, as the statements of a module do.
const program = (definition: string) => `
const make = number => JSON.parse(process.argv.length > 99 ? String(number) : "[{}]")[0];
var __defProp = Object.defineProperty;
function define(target, value) { ${definition} return target.held; }
let sum = 0;
${numbers.map(number => `sum += define(make(${number}), ${number});`).join("\n")}
console.log(sum);
`;

const files = {
  "a-value.cjs": program(`Object.defineProperty(target, "held", { value, enumerable: true });`),
  "a-getter.cjs": program(
    `Object.defineProperty(target, "held", { get: () => value, enumerable: true, configurable: true });`,
  ),
  "under-another-name.cjs": program(
    `__defProp(target, "held", { value, writable: true, enumerable: false, configurable: true });`,
  ),
};

test.each(Object.keys(files))(
  "one operation defines the property, and the built-in is not called: %s",
  async entry => {
    using dir = tempDir("aot-a-descriptor-that-is-written-out", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counts = join(String(dir), "counts.txt");
    const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
      stdout: `${(numberOfObjects * (numberOfObjects - 1)) / 2}\n`,
      stderr: "",
      exitCode: 0,
    });
    const definitions = readFileSync(counts, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([, what]) => what === "operation:operationAOTDefineOwnProperty")
      .reduce((sum, [times]) => sum + Number(times), 0);
    expect(definitions).toBeGreaterThanOrEqual(numberOfObjects);
  },
  240_000,
);
