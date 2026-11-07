// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The function that `forEach` calls keeps its third argument, the list, in a constant and stores to that.
const names = ["A", "B"];
names.forEach((name, index, list) => {
  const same = list;
  same[index] = name.toLowerCase();
});
for (const name of names) console.log(require("./lib/" + name + ".cjs").who);

// FILE: lib/a.cjs
exports.who = "lib/a";

// FILE: lib/b.cjs
exports.who = "lib/b";

// FILE: lib/c.cjs
exports.who = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
