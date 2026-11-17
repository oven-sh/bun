import { createRequire } from "node:module";
const read = new Function("load", "return typeof load('zlib').gzipSync");
let answer;
try { answer = read(createRequire(import.meta.url)); } catch (error) { answer = error.name + ": " + error.message; }
console.log(answer);
