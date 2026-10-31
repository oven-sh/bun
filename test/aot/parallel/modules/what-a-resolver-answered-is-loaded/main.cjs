const path = require("path");
const say = (name, ask) => {
  try {
    console.log(name, ask());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};

say("written out", () => require(require.resolve("./one.cjs")).which);

const chosen = require.resolve(process.argv.length > 7 ? "./one.cjs" : "./two.cjs");
say("chosen", () => require(chosen).which);
say("chosen is the module that is written out", () => require(chosen) === require("./two.cjs"));

let found;
try {
  found = require.resolve("./none.cjs");
} catch {
  found = require.resolve("./one.cjs");
}
say("the first that is there", () => require(found).which);

const wanted = process.argv[9] ?? "second";
say("out of a folder", () => require(require.resolve("./plugins/" + wanted + ".cjs")).which);
say("below the folder of the file", () => require(require.resolve(path.join(__dirname, "two.cjs"))).which);
say("a library module", () => typeof require(require.resolve("fs")).readFileSync);
say("a library module with its prefix", () => require(require.resolve("node:path")) === path);
say("asked again", () => path.basename(require.resolve(chosen)));
say("asked again and loaded", () => require(require.resolve(require.resolve("./one.cjs"))).which);

const load = file => require(file).which;
say("handed to a function", () => load(require.resolve("./one.cjs")) + load(require.resolve("./two.cjs")));
say("each of a list", () =>
  [require.resolve("./one.cjs"), require.resolve("./two.cjs")].map(file => require(file).which).join(),
);

import(require.resolve("./two.cjs")).then(loaded => console.log("imported", loaded.default.which));
