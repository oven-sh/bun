// Functions return what `require()` answers, and the file that is required throws while it runs. The program prints the frames of each error.
import { createRequire } from "node:module";
import strict from "./strict.cjs";
import sloppy from "./sloppy.cjs";
const require = createRequire(import.meta.url);
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4])
    .join(" < ");
}
function attempt(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", framesOf(error));
  }
}
function returnsRequire() {
  return require("./throws-1.cjs");
}
function keepsRequire() {
  const loaded = require("./throws-2.cjs");
  return loaded;
}
attempt("an arrow function", () => require("./throws-3.cjs"));
attempt("a function that returns it", returnsRequire);
attempt("a function that keeps it", keepsRequire);
attempt("import.meta.require", () => import.meta.require("./throws-4.cjs"));
attempt("strict CommonJS", strict.direct);
attempt("strict CommonJS, a member", strict.member);
attempt("strict CommonJS, module.require", strict.viaModule);
attempt("sloppy CommonJS", sloppy.direct);
attempt("an ES module", () => require("./throws-9.mjs"));
