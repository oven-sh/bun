// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5
// CHECK-LABEL: function {{*}}name="row"

// FILE: main.cjs
// The body of a CommonJS file is a sloppy function: a direct eval and its `arguments` store to `__dirname` too, and a specifier that is
// built from it is then a computed name, which finds entry points alone.
require("./a.js"), require("./other/a.js");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("eval", () => require("./by-eval.cjs"));
row("arguments", () => require("./by-arguments.cjs"));

// FILE: a.js
module.exports = "here";

// FILE: by-arguments.cjs
arguments[4] = arguments[4] + "/other";
module.exports = require(__dirname + "/a.js");

// FILE: by-eval.cjs
eval("__dirname = __dirname + \"/other\"");
module.exports = require(__dirname + "/a.js");

// FILE: other/a.js
module.exports = "there";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
