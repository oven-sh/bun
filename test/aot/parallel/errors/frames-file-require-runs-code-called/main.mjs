// Files that `require()` runs read a stack. The program prints every frame of it, also those that have no file.
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
globalThis.framesOf = function framesOf(stack) {
  return String(stack)
    .split("\n")
    .filter(line => /^\s*at /.test(line))
    .map(line =>
      line
        .trim()
        .slice(3)
        .replace(/[^ ()]*[\/\\]([\w.-]+:\d+:\d+)/, "$1"),
    )
    .join(" < ");
};
globalThis.show = function show(label) {
  console.log(label, "|", framesOf(new Error().stack));
};
function attempt(label, run) {
  try {
    run();
  } catch (error) {
    console.log(label, "|", error.name, "|", framesOf(error.stack));
  }
}
function written() {
  const first = require("./common-1.cjs");
  const second = require("./module-1.mjs");
  return [first, second];
}
const throughImportMeta = () => import.meta.require("./common-2.cjs");
const moduleThroughImportMeta = () => import.meta.require("./module-2.mjs");
function throughCreateRequire() {
  const first = made("./common-3.cjs");
  const second = made("./module-3.mjs");
  return [first, second];
}
function computed(number) {
  const first = require("./common-" + number + ".cjs");
  const second = require("./module-" + number + ".mjs");
  return [first, second];
}
function inTailPosition() {
  return require("./common-5.cjs");
}
function moduleInTailPosition() {
  return require("./module-5.mjs");
}
written();
throughImportMeta();
moduleThroughImportMeta();
throughCreateRequire();
computed(4);
inTailPosition();
moduleInTailPosition();
const fromCommonJS = require("./requires.cjs");
fromCommonJS.written();
fromCommonJS.throughModule();
fromCommonJS.inTailPosition();
written();
attempt("a CommonJS file that throws", () => void require("./common-throws.cjs"));
attempt("a module that throws", () => void require("./module-throws.mjs"));
attempt("a module that awaits", () => void require("./module-awaits.mjs"));
function deep(depth) {
  if (depth > 0) return 1 + deep(depth - 1);
  require("./common-9.cjs");
  require("./module-9.mjs");
  return 0;
}
deep(6);
Error.stackTraceLimit = 3;
require("./common-10.cjs");
require("./module-10.mjs");
Error.stackTraceLimit = 2;
require("./common-11.cjs");
require("./module-11.mjs");
Error.stackTraceLimit = 10;
Error.prepareStackTrace = (error, sites) =>
  sites
    .map(site =>
      [
        site.getFunctionName(),
        site.isNative(),
        site.isToplevel(),
        site.getLineNumber(),
        site.getColumnNumber(),
        typeof site.getFileName(),
      ].join(),
    )
    .join(" < ");
globalThis.framesOf = stack => stack;
require("./common-12.cjs");
require("./module-12.mjs");
/* Output:
common-1 | show (main.mjs:17:40) < <anonymous> (common-1.cjs:1:12) < anonymous (unknown) < written (main.mjs:27:17) < main.mjs:49:1
module-1 | show (main.mjs:17:40) < module-1.mjs:1:12 < unknown < written (main.mjs:28:18) < main.mjs:49:1
common-2 | show (main.mjs:17:40) < <anonymous> (common-2.cjs:1:12) < anonymous (unknown) < main.mjs:50:1
module-2 | show (main.mjs:17:40) < module-2.mjs:1:12 < unknown < main.mjs:51:1
common-3 | show (main.mjs:17:40) < <anonymous> (common-3.cjs:1:12) < anonymous (unknown) < throughCreateRequire (main.mjs:34:17) < main.mjs:52:1
module-3 | show (main.mjs:17:40) < module-3.mjs:1:12 < unknown < throughCreateRequire (main.mjs:35:18) < main.mjs:52:1
common-4 | show (main.mjs:17:40) < <anonymous> (common-4.cjs:1:12) < anonymous (unknown) < computed (main.mjs:39:17) < main.mjs:53:1
module-4 | show (main.mjs:17:40) < module-4.mjs:1:12 < unknown < computed (main.mjs:40:18) < main.mjs:53:1
common-5 | show (main.mjs:17:40) < <anonymous> (common-5.cjs:1:12) < anonymous (unknown) < main.mjs:54:1
module-5 | show (main.mjs:17:40) < module-5.mjs:1:12 < unknown < main.mjs:55:1
common-8 | show (main.mjs:17:40) < <anonymous> (common-8.cjs:1:12) < anonymous (unknown) < <anonymous> (requires.cjs:15:1) < anonymous (unknown) < main.mjs:56:22
module-8 | show (main.mjs:17:40) < module-8.mjs:1:12 < unknown < <anonymous> (requires.cjs:16:1) < anonymous (unknown) < main.mjs:56:22
common-6 | show (main.mjs:17:40) < <anonymous> (common-6.cjs:1:12) < anonymous (unknown) < written (requires.cjs:2:17) < main.mjs:57:14
module-6 | show (main.mjs:17:40) < module-6.mjs:1:12 < unknown < written (requires.cjs:3:18) < main.mjs:57:14
common-7 | show (main.mjs:17:40) < <anonymous> (common-7.cjs:1:12) < anonymous (unknown) < throughModule (requires.cjs:7:17) < main.mjs:58:14
module-7 | show (main.mjs:17:40) < module-7.mjs:1:12 < unknown < throughModule (requires.cjs:8:18) < main.mjs:58:14
an imported CommonJS file | show (main.mjs:17:40) < <anonymous> (imported.cjs:1:12) < unknown < main.mjs:59:14
required by an imported CommonJS file | show (main.mjs:17:40) < <anonymous> (required-by-imported.cjs:1:12) < anonymous (unknown) < <anonymous> (imported.cjs:2:1) < unknown < main.mjs:59:14
an imported module | show (main.mjs:17:40) < imported.mjs:1:12 < unknown < main.mjs:59:14
a module that imports | show (main.mjs:17:40) < imports.mjs:3:12 < unknown < main.mjs:59:14
a CommonJS file that throws | Error | thrower (common-throws.cjs:2:13) < <anonymous> (common-throws.cjs:2:27) < anonymous (unknown) < <anonymous> (main.mjs:61:51) < attempt (main.mjs:21:5) < main.mjs:61:1
a module that throws | Error | thrower (module-throws.mjs:2:13) < module-throws.mjs:2:27 < unknown < <anonymous> (main.mjs:62:44) < attempt (main.mjs:21:5) < main.mjs:62:1
a module that awaits | show (main.mjs:17:40) < module-awaits.mjs:1:12 < unknown < <anonymous> (main.mjs:63:44) < attempt (main.mjs:21:5) < main.mjs:63:1
behind the await | show (main.mjs:17:40) < module-awaits.mjs:3:12 < unknown < <anonymous> (main.mjs:63:44) < attempt (main.mjs:21:5) < main.mjs:63:1
common-9 | show (main.mjs:17:40) < <anonymous> (common-9.cjs:1:12) < anonymous (unknown) < deep (main.mjs:66:3) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29)
module-9 | show (main.mjs:17:40) < module-9.mjs:1:12 < unknown < deep (main.mjs:67:3) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29) < deep (main.mjs:65:29)
common-10 | show (main.mjs:17:40) < <anonymous> (common-10.cjs:1:12) < anonymous (unknown)
module-10 | show (main.mjs:17:40) < module-10.mjs:1:12 < unknown
common-11 | show (main.mjs:17:40) < <anonymous> (common-11.cjs:1:12)
module-11 | show (main.mjs:17:40) < module-11.mjs:1:12
common-12 | show,false,true,17,40,string < ,false,true,1,12,string < anonymous,true,true,1,1,string < ,false,true,92,1,string
module-12 | show,false,true,17,40,string < ,false,true,1,12,string < ,true,true,1,1,string < ,false,true,93,1,string
*/
