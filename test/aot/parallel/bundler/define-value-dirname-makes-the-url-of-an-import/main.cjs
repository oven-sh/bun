// `import()` takes the URL that `pathToFileURL()` makes of a path that begins with a name whose `--define` value is `__dirname`: the build finds the files that the path may name, as where `__dirname` is spelled.
// Flags: --define HERE=__dirname
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const name = Date.now() > 0 ? "a" : "b";
import(pathToFileURL(path.join(HERE, "lib", name + ".mjs")).href).then(loaded => console.log(loaded.name));
