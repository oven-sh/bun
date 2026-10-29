// A folder whose package json names its main file is loaded under a computed name.
// Entry points: ./tool/start.js ./tool/index.js ./tool/inner/from.cjs ./kit/lib/index.js ./kit/index.js ./both/common.cjs ./both/es.mjs ./bare/index.js
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const fromInner = require("./tool/inner/from.cjs");

const spell = written => written.replaceAll("|", "/");
const belowThisFolder = path => path.slice(__dirname.length).replaceAll("\\", "/");

console.log(require("./tool"), require("./kit"), require("./both"), require("./bare"));

async function main() {
  for (const written of [".|tool", ".|tool|", ".|tool|.", ".|tool|index", ".|kit", ".|kit|", ".|both", ".|bare"]) {
    const name = spell(written);
    console.log(
      name,
      require(name),
      belowThisFolder(require.resolve(name)),
      module.require(name),
      createRequire(__filename)(name),
      (await import(name)).default,
    );
  }
  for (const written of ["..", "..|", "..|..|kit", "..|index"]) console.log(written, fromInner(spell(written)));
  const path = __dirname + spell("|tool");
  const url = pathToFileURL(__dirname).href + spell("|tool|");
  console.log(require(path), (await import(path)).default, require(url), (await import(url)).default);
}

main();
