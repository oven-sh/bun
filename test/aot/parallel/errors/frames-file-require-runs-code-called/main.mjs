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
