const path = require("node:path");
const say = (what, make) => {
  try {
    console.log(what, String(make()));
  } catch (e) {
    console.log(what, "THROWS", e.code ?? e.name);
  }
};
for (const name of ["a", "b"])
  say("by __dirname " + name, () => require(path.join(__dirname, "plugins", name + ".cjs")).name);
say("from the first file", () => require("./plugins/" + ["a", ".cjs"].join("")).name);
say("from a file in a folder", () => require("./lib/loader.cjs").load("x.cjs").name);
say("from a module in a folder", () => require("./lib/made.mjs").load("./near/x.cjs").name);
say("without the extension", () => require(path.join(__dirname, "plugins", "a")).name);
say(
  "one module",
  () => require(path.join(__dirname, "plugins", "a.cjs")) === require("./plugins/" + ["a", ".cjs"].join("")),
);
say(
  "the module that a written name yields",
  () => require(path.join(__dirname, "plugins", "b.cjs")) === require("./plugins/b.cjs"),
);
say("no such file", () => require(path.join(__dirname, "plugins", "none.cjs")));
say("what resolve yields can be required", () => require(require("./lib/loader.cjs").resolved).name);
say("runs", () => [globalThis.runsOfA, globalThis.runsOfB, globalThis.runsOfX]);
const fs = require("node:fs");
say("is there", () => [
  fs.existsSync(path.join(__dirname, "plugins", "a.cjs")),
  fs.existsSync(path.join(__dirname, "plugins", "none.cjs")),
  fs.statSync(path.join(__dirname, "plugins")).isDirectory(),
]);
say("a folder lists each file once, under the name of its source", () =>
  fs.readdirSync(path.join(__dirname, "plugins")).sort(),
);
say("a folder that is listed and loaded", () =>
  fs
    .readdirSync(path.join(__dirname, "plugins"))
    .sort()
    .filter(file => file.endsWith(".cjs"))
    .map(file => require(path.join(__dirname, "plugins", file)).name),
);
import(path.join(__dirname, "plugins", "es.mjs"))
  .then(
    ns => console.log("import()", ns.name, ns.default),
    e => console.log("import() THROWS", e.code ?? e.name),
  )
  .then(() => require("./lib/made.mjs").imports("./near/es.mjs"))
  .then(
    ns => console.log("import() from a module in a folder", ns.name),
    e => console.log("import() THROWS", e.code ?? e.name),
  )
  .then(() => {
    const { Worker } = require("node:worker_threads");
    const worker = new Worker(path.join(__dirname, "worker.cjs"));
    worker.on("message", said => console.log("worker", said));
    worker.on("error", e => console.log("worker THROWS", e.code ?? e.name));
  });
