// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8
// CHECK-LABEL: function {{*}}name="row"

// FILE: main.cjs
// `__dirname` and `__filename` are variables. Once the program stores to one, a specifier that is built from it is a computed name, which
// finds entry points alone: the build does not load the file beside this one in its place.
require("./a.js"), require("./other/a.js");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("stored", () => require("./stored.cjs"));
row("added", () => require("./added.cjs"));
row("in a function", () => require("./in-a-function.cjs"));
row("filename", () => require("./filename.cjs"));
row("untouched", () => require("./untouched.cjs"));

// FILE: a.js
module.exports = "here";

// FILE: added.cjs
__dirname += "/other";
module.exports = require(`${__dirname}/a.js`);

// FILE: filename.cjs
__filename = __dirname + "/other/a";
module.exports = require(__filename + ".js");

// FILE: in-a-function.cjs
function move() {
  __dirname = __dirname + "/other";
}
move();
module.exports = require(__dirname + "/a.js");

// FILE: other/a.js
module.exports = "there";

// FILE: stored.cjs
__dirname = __dirname + "/other";
module.exports = require(__dirname + "/a.js");

// FILE: untouched.cjs
module.exports = require(__dirname + "/a.js");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
