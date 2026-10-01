// Is the order of a sorted walk equal to the byte order of the whole paths? (research probe)
import { enumerateFiles } from "./compiler_runner";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const walk = [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)].map(f => f.slice(root.length + 1));
const sorted = [...walk].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
let diff = 0;
let first = "";
for (let i = 0; i < walk.length; i++) if (walk[i] !== sorted[i]) { diff++; if (first === "") first = `${i}: walk ${walk[i]} / sorted ${sorted[i]}`; }
console.log("files", walk.length, "positions that differ", diff, first);
const js = [...walk].sort();
let d2 = 0;
for (let i = 0; i < walk.length; i++) if (js[i] !== sorted[i]) d2++;
console.log("default JS sort against byte sort, positions that differ", d2);
