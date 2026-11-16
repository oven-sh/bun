// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4
// CHECK-LABEL: function {{*}}name="lower"

// FILE: main.cjs
// The function that `forEach` calls is declared elsewhere.
const names = ["A", "B"];
function lower(name, index, list) {
  list[index] = name.toLowerCase();
}
names.forEach(lower);
for (const name of names) console.log(require("./lib/" + name + ".cjs").who);

// FILE: lib/a.cjs
exports.who = "lib/a";

// FILE: lib/b.cjs
exports.who = "lib/b";

// FILE: lib/c.cjs
exports.who = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
