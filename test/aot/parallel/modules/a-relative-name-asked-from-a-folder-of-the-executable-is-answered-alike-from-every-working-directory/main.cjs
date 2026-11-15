// `require.resolve(name, { paths: [module.path] })` asks from the folder of the asking file. In an executable that is a folder of the executable, and no folder on disk
// is known to stand for it: the working directory is none. So a file of the same name that lies there changes nothing, and the answer is that of the written name.
const path = require("node:path");
require("./held.cjs");
const made = "./he" + JSON.parse('"ld.cjs"');
const written = require.resolve("./held.cjs");
const ask = folders => {
  try {
    return require.resolve(made, { paths: folders }) === written ? "the file of the program" : "ANOTHER FILE";
  } catch (error) {
    return error.code;
  }
};
for (const folder of [".", "elsewhere", path.join("elsewhere", "..")]) {
  process.chdir(path.join(__dirname, folder));
  console.log(
    folder,
    "|",
    ask([module.path]),
    "|",
    ask(["/nowhere-at-all", module.path]),
    "|",
    ask([path.dirname(module.filename)]),
  );
}
