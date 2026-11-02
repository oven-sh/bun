// Each file calls require() and has a top-level await that no run reaches: behind a throw, a break or a continue. Nothing else in its text tells what kind of module it is. A file whose text has a top-level await is an ES module, so its code is strict and it has no `module`.
const { join } = require("node:path");
try {
  throw 0;
  await 0;
} catch {}

function describe() {
  const frozen = Object.freeze({ count: 1 });
  let stored = "stored";
  try {
    frozen.count = 2;
  } catch (error) {
    stored = error.name;
  }
  return [stored, this === undefined, typeof module].join(" ");
}
console.log(join("a", "b"), describe());
import("./behind-a-break.js")
  .then(() => import("./behind-a-continue.js"))
  .then(() => import("./in-a-loop-that-awaits.js"));
