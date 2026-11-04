// The exports of exports-that-let-in-unseen-code-bound-by-name.mjs in checked code: a function with a declared result carries no expected type along, so a wrong proof of what the binding holds ends as a constant there, without a crash.
import { getProtectedObjects } from "bun:jsc";
import { runMain } from "node:module";

function nameOf(): string | undefined { return runMain?.name; }
function nameOfEnumerator(): string | undefined { return getProtectedObjects?.name; }
function lengthOf(): number | string { if (typeof runMain === "function") return runMain.length; return "no function"; }
class K { x = typeof runMain === "function" ? runMain.name : undefined; }
class E { x = typeof getProtectedObjects === "function" ? getProtectedObjects.name : undefined; }
console.log(typeof runMain, nameOf(), lengthOf());
console.log(typeof getProtectedObjects, nameOfEnumerator());
console.log(new K().x, new E().x);
