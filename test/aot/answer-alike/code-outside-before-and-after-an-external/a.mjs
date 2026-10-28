// The program loads a file beside it by a computed path, and then a package that the build left outside.
import { join } from "node:path";
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const file = join(process.cwd(), decoded("other.mjs"));
let answer;
try { answer = (await import(file)).default; } catch (error) { answer = error.code ?? error.name; }
await import("outside-package");
console.log(answer);
