// Writes lit.ts: the zero options as an object literal, from the names that tsconfig.ts declares.
import { newCompilerOptions } from "/tmp/rtb1b/repo/test/cli/lint/conformance/runner/tsconfig";
const zero = newCompilerOptions() as Record<string, unknown>;
const names = Object.keys(zero);
const lit = "{ " + names.map(n => `${n}: ${JSON.stringify(zero[n]) ?? "undefined"}`).join(", ") + " }";
await Bun.write("/tmp/rtb1b/bench/lit.ts", `export const names = ${JSON.stringify(names)};\nexport function makeLiteral(): Record<string, unknown> {\n  return ${lit};\n}\nexport const template: Record<string, unknown> = ${lit};\n`);
console.log(names.length, "fields");
