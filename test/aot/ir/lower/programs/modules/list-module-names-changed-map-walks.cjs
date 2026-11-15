// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The list is a literal that `map` walks. The function stores to a later element, which `map` then hands to it.
const mapped = ["a", "b"].map((name, index, list) => {
  list[1] = "c";
  return name;
});
for (const name of mapped) console.log(require("./lib/" + name + ".cjs").who);

// FILE: lib/a.cjs
exports.who = "lib/a";

// FILE: lib/b.cjs
exports.who = "lib/b";

// FILE: lib/c.cjs
exports.who = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
