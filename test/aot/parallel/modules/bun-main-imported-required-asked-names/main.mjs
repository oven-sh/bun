// "bun:main" is a module that exports nothing: it is imported, required and loaded under a computed name, by the entry point, by files below it and by a Worker.
// Entry points: ./worker.mjs
import * as early from "bun:main";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
const require = createRequire(import.meta.url);
const describe = value => [typeof value, Object.prototype.toString.call(value), Object.keys(value).join()].join(" ");
const attempt = async (what, load) => {
  try {
    console.log(what + ":", describe(await load()));
  } catch (error) {
    console.log(what + ": failed:", error.constructor.name, error.message);
  }
};
console.log("imported by the entry point:", describe(early));
await attempt("required by the entry point", () => require("bun:main"));
await attempt("required by a CommonJS file", () => require("./requires-it.cjs"));
const loadLater = async () => {
  await 0;
  const computed = ["bun", "main"].join(":");
  await attempt("import()", () => import("bun:main"));
  await attempt("import() of a computed name", () => import(computed));
  await attempt("require() of a computed name", () => require(computed));
  console.log(
    "one module:",
    (await import("bun:main")) === early,
    (await import(computed)) === early,
    require("bun:main") === early,
  );
  console.log(
    "resolved:",
    import.meta.resolve("bun:main"),
    require.resolve("bun:main"),
    Bun.resolveSync("bun:main", import.meta.dir),
  );
  console.log("process.getBuiltinModule:", process.getBuiltinModule("bun:main"), process.getBuiltinModule(computed));
  await attempt("a module that imports its namespace", () => import("./imports-namespace.mjs"));
  await attempt("a module that imports a name", () => import("./imports-a-name.mjs"));
  await attempt("the same module again", () => import("./imports-a-name.mjs"));
  await attempt("a module that imports the default", () => import("./imports-default.mjs"));
  await attempt("a module that hands on every name", () => import("./hands-on-every-name.mjs"));
  const worker = new Worker(new URL("./worker.mjs", import.meta.url));
  worker.on("message", line => console.log("in a Worker:", line));
  worker.on("error", error => console.log("the Worker failed:", error.message));
};
loadLater();
