// WebAssembly's vectors are refused where the processor has no AVX, with and without a JIT.
import { readFileSync } from "node:fs";
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 25, 1, 23, 0, 253, 12, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 253, 27, 2, 11]);
let hasVectors = true;
if (process.platform === "linux" && process.arch === "x64") hasVectors = readFileSync("/proc/cpuinfo", "latin1").split("\n").some(line => line.startsWith("flags") && line.split(" ").includes("avx"));
let answer;
try {
  answer = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f();
} catch (error) {
  answer = error.constructor.name;
}
console.log(WebAssembly.validate(bytes) === hasVectors, answer === (hasVectors ? 3 : "CompileError"));
