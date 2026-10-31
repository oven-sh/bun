// A folder and a file of one name are loaded under computed names.
// Entry points: ./part.js ./part/index.js ./typed.ts ./typed/index.ts ./node_modules/driver/start.js ./node_modules/driver/lib.js ./node_modules/driver/lib/index.js ./node_modules/closed/start.js ./node_modules/closed/feature.js
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const spell = written => written.replaceAll("|", "/");
const belowThisFolder = path => path.slice(__dirname.length).replaceAll("\\", "/");
const attempt = load => {
  try {
    return load();
  } catch (error) {
    return error.code;
  }
};

const names = [
  ".|part",
  ".|part|",
  ".|part|.",
  ".|part|.|",
  ".|part||",
  ".|typed|..|part|",
  ".|part|index|..",
  ".|part.js|",
  ".|part|index",
  ".|part\\",
  ".|part\\index.js",
  ".|typed\\..\\part|",
  ".|typed",
  ".|typed|",
  ".|typed.js",
  ".|typed.js|",
  "driver",
  "driver|",
  "driver|lib",
  "driver|lib|",
  "driver|lib|.",
  "driver|lib.js|",
  "driver|lib||",
  "driver|lib\\",
  "driver\\lib",
  "driver\\lib|",
  "driver|..|closed|start",
  "closed",
  "closed|",
  "closed|feature",
  "closed|feature|",
  "closed|feature|.",
  "closed|feature\\",
  "closed||feature",
  "closed|.|feature",
  "closed|feature.js",
  "closed|start",
  "closed|start.js",
  "closed\\feature",
  "closed\\start",
];

async function main() {
  for (const written of names) {
    const name = spell(written);
    console.log(
      name,
      attempt(() => require(name)),
      attempt(() => belowThisFolder(require.resolve(name))),
      attempt(() => module.require(name)),
      attempt(() => createRequire(__filename)(name)),
      await import(name).then(
        namespace => namespace.default,
        error => error.code,
      ),
    );
  }
  for (const written of ["part", "part|", "part|.", "typed|"]) {
    const path = __dirname + spell("|" + written);
    const url = pathToFileURL(__dirname).href + spell("|" + written);
    console.log(written, require(path), belowThisFolder(require.resolve(path)), (await import(path)).default);
    console.log(written, require(url), (await import(url)).default);
  }
}

main();
