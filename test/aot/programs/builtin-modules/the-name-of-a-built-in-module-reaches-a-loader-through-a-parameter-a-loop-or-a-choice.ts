// The name of a built-in module is written as a constant, and reaches the call that loads it through a parameter, a loop or a choice.
import { createRequire } from "node:module";

const throughAnArrow = (name: string): any => import.meta.require(name);
console.log("an arrow", typeof throughAnArrow("fs").readFileSync);

function throughAFunction(name: string): any {
  return import.meta.require(name);
}
console.log("a function", typeof throughAFunction("node:path").join);

const twoNames = (name: string): any => import.meta.require(name);
console.log("two names", typeof twoNames("fs").readFileSync, typeof twoNames("node:path").join);

const inALoop = (name: string): any => import.meta.require(name);
for (const name of ["fs", "node:path", "node:os"]) console.log("a loop", name, typeof inALoop(name));

for (const name of ["node:util", "node:url"]) console.log("without a function", name, typeof import.meta.require(name));

const made = createRequire(import.meta.url);
const throughOneThatWasMade = (name: string): any => made(name);
for (const name of ["fs", "node:events"])
  console.log("a require that was made", name, typeof throughOneThatWasMade(name));

const imported = (name: string): Promise<any> => import(name);
for (const name of ["fs", "node:path"]) console.log("imported", name, typeof (await imported(name)).default);

const isFirst = process.argv.length < 100;
console.log("a choice", typeof import.meta.require(isFirst ? "node:vm" : "node:v8").runInNewContext);
