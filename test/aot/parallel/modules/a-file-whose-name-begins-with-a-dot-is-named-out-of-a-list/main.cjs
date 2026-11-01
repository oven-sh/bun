// The build knows the name of the file out of a list. A name that begins with a dot is found as any other, as it is where the build walks the folder.
console.log(require("./names/" + [".hidden.js"][0]).which);
for (const name of [".hidden.js", "seen.js"]) console.log(require("./names/" + name).which);
const stem = [".hidden"][0];
console.log(require(`./names/${stem}.js`).which);
console.log(require("./names/" + (process.argv[2] ?? [".hid", "den.js"].join(""))).which);
import("./names/" + [".hidden.js"][0]).then(names => console.log(names.default.which));
