// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// The function that `forEach` calls only asks its third argument, the list.
const names = ["a", "b"];
names.forEach((name, index, list) => {
  console.log(index, list.includes(name), list[index] === name, list.join());
});
console.log(names.map((name, index, list) => name + list.length).join());
for (const name of names) console.log(require("./lib/" + name + ".cjs").who);

// FILE: lib/a.cjs
exports.who = "lib/a";

// FILE: lib/b.cjs
exports.who = "lib/b";

// FILE: lib/c.cjs
exports.who = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
