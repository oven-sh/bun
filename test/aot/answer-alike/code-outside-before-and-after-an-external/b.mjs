// The two loads of a.mjs in the other order.
import { join } from "node:path";
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const file = join(process.cwd(), decoded("other.mjs"));
let answer;
await import("outside-package");
try { answer = (await import(file)).default; } catch (error) { answer = error.code ?? error.name; }
console.log(answer);
