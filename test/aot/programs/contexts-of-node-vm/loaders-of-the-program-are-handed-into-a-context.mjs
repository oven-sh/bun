// require, process.getBuiltinModule and process are handed into a context of node:vm, whose text asks them for modules that the program imports too.
import "node:fs";
import { createRequire } from "node:module";
import "node:os";
import "node:path";
import "node:util";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
const require = createRequire(import.meta.url);
await show("require", () =>
  vm.runInNewContext(
    "[typeof require('node:path').join, typeof require('node:os').EOL, typeof require('node:fs').readFileSync, require('node:util').format('%s-%d', 'a', 1)]",
    { require },
  ),
);
await show("getBuiltinModule", () =>
  vm.runInNewContext("[typeof get('node:path').join, typeof get('node:os').EOL, get('nothing')]", {
    get: process.getBuiltinModule,
  }),
);
await show("process", () =>
  vm.runInNewContext(
    "[typeof process.getBuiltinModule('node:path').join, typeof process.stdout.write, typeof process.nextTick, process.argv.length > 0]",
    { process },
  ),
);
