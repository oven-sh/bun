// Each line: a built-in module that a statement imports, asked for again under a name that is made at run time.
import * as abortController from "abort-controller";
import * as bun from "bun";
import * as jsc from "bun:jsc";
import * as buffer from "node:buffer";
import * as constants from "node:constants";
import * as nodeModule from "node:module";
import * as path from "node:path";
import * as nodeProcess from "node:process";
import * as stringDecoder from "node:string_decoder";
import * as types from "node:util/types";
import vm from "node:vm";
import * as validate from "utf-8-validate";
import * as vercelFetch from "@vercel/fetch";

const made = text => text.split("").join("");
const ask = name => import(name);
async function countTurns(load) {
  let turns = 0;
  let isDone = false;
  const count = () => {
    if (isDone) return;
    turns++;
    Promise.resolve().then(count);
  };
  count();
  await load();
  isDone = true;
  return turns;
}

const written = {
  "abort-controller": abortController,
  "bun:jsc": jsc,
  "node:buffer": buffer,
  "node:constants": constants,
  "node:module": nodeModule,
  "node:path": path,
  "node:process": nodeProcess,
  "node:string_decoder": stringDecoder,
  "node:util/types": types,
  "utf-8-validate": validate,
  "@vercel/fetch": vercelFetch,
};
for (const [name, namespace] of Object.entries(written)) {
  const text = `import(${JSON.stringify(name)})`;
  console.log(
    name + ":",
    await countTurns(() => ask(made(name))),
    await countTurns(() => ask(made(name))),
    (await ask(made(name))) === namespace,
    (await (0, eval)(text)) === namespace,
    (await new Function("name", "return import(name)")(name)) === namespace,
    (await vm.runInThisContext(text, { importModuleDynamically: ask })) === namespace,
    (await ask(made(name))).default === namespace.default,
    require(made(name)) === require(name),
    import.meta.resolve(made(name)),
    require.resolve(made(name)),
  );
}
for (const [name, namespace] of Object.entries({ buffer, constants, module: nodeModule, process: nodeProcess, string_decoder: stringDecoder, "util/types": types }))
  console.log(name + ":", (await ask(made(name))) === namespace, import.meta.resolve(made(name)));

console.log("a prefix and the rest:", (await ask("bun:" + made("jsc"))) === jsc, require("bun:" + made("jsc")) === jsc.default);
console.log("bun:", (await ask(made("bun"))) === bun, (await ask(made("bun"))) === (await ask(made("bun"))), (await import("bun")) === bun, require(made("bun")) === bun.default);

for (const name of ["node:buffer", "bun:jsc"]) {
  require.cache[made(name)] = { exports: 1 };
  console.log("an entry of the cache:", require.cache[made(name)].exports, made(name) in require.cache, Object.keys(require.cache).includes(name), require(made(name)) === 1);
  console.log(delete require.cache[made(name)], made(name) in require.cache, require(made(name)) === written[name].default);
}
/* Output:
abort-controller: 10 10 true true true true true true abort-controller abort-controller
bun:jsc: 10 10 true true true true true true bun:jsc bun:jsc
node:buffer: 10 10 true true true true true true node:buffer node:buffer
node:constants: 10 10 true true true true true true node:constants node:constants
node:module: 10 10 true true true true true true node:module node:module
node:path: 10 10 true true true true true true node:path node:path
node:process: 10 10 true true true true true true node:process node:process
node:string_decoder: 10 10 true true true true true true node:string_decoder node:string_decoder
node:util/types: 10 10 true true true true true true node:util/types node:util/types
utf-8-validate: 10 10 true true true true true true utf-8-validate utf-8-validate
@vercel/fetch: 10 10 true true true true true true @vercel/fetch @vercel/fetch
buffer: true node:buffer
constants: true node:constants
module: true node:module
process: true node:process
string_decoder: true node:string_decoder
util/types: true node:util/types
a prefix and the rest: true true
bun: false true true false
an entry of the cache: 1 true true false
true false true
exit code 1
error: Cannot store an entry under 'bun:jsc' in require.cache: the build saw no store under that key, so require("bun:jsc") always returns the compiled module. Write the key out where you store it, as in require.cache["bun:jsc"] = entry, or use mock.module() in a test. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
