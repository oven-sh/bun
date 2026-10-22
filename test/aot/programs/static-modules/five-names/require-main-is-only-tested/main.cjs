// `require.main` is compared with `module` and asked for its type, and nothing else is done with it, in the entry point and in a file that it requires.
console.log(require.main === module, typeof require.main, !require.main, require.main ? "there" : "not there", require.main == null);
require("./helper.cjs");
const nameOf = path => path.slice(path.lastIndexOf("/") + 1);
console.log(nameOf(require.main.filename), require.main.id, require.main.loaded, typeof require.main.path);
