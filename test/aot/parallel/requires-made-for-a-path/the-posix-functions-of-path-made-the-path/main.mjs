// createRequire() of a path that the functions of node:path/posix, path/posix and path.posix make out of the file's own. Everywhere but on Windows they are the functions of
// node:path, so the build reads the folder that the require looks from, however the function is reached and however the require is called. No file here is imported by name:
// what a require finds, the build brought in for it.
import { createRequire } from "node:module";
import path from "node:path";
import { dirname, join, resolve } from "node:path/posix";
import * as posix from "path/posix";
function report(way, act) {
  let said;
  try {
    said = act();
  } catch (error) {
    said = error.code ?? error.name;
  }
  console.log(way + ":", said);
}
report(
  "join() beside the file",
  () => createRequire(join(dirname(import.meta.filename), "start.cjs"))("./part.cjs").said,
);
report(
  "join() into a folder",
  () => createRequire(join(import.meta.dirname, "vendor", "start.cjs"))("./part.cjs").said,
);
report(
  "resolve() and a separator",
  () => createRequire(resolve(import.meta.dirname, "other") + "/")("./part.cjs").said,
);
report(
  "path.posix.join()",
  () => createRequire(path.posix.join(import.meta.dirname, "vendor", "start.cjs"))("./second.cjs").said,
);
report(
  "a namespace",
  () => createRequire(posix.join(posix.dirname(import.meta.filename), "other", "start.cjs"))("./second.cjs").said,
);
const held = createRequire(join(import.meta.dirname, "vendor", "start.cjs"));
report("held", () => held("./third.cjs").said);
report("held, call()", () => held.call(null, "./fourth.cjs").said);
report("held, apply()", () => held.apply(null, ["./fifth.cjs"]).said);
report("held, resolve()", () => held.resolve("./sixth.cjs").slice(-"vendor/sixth.cjs".length));
report("held, a built-in module", () => typeof held("node:os").platform);
report("held, a file of another folder", () => held("../other/third.cjs").said);
await import("./asks.cjs");
