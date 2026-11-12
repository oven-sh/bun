// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 25

// FILE: main.cjs
// Each of these members of a list hands the list to the function that it calls.
const mappedNames = ["A"];
mappedNames.map((name, at, list) => (list[at] = "a"));
const filteredNames = ["A"];
filteredNames.filter((name, at, list) => (list[at] = "b"));
const foundNames = ["A"];
foundNames.find((name, at, list) => (list[at] = "c"));
const lastFoundNames = ["A"];
lastFoundNames.findLast((name, at, list) => (list[at] = "a"));
const indexedNames = ["A"];
indexedNames.findIndex((name, at, list) => (list[at] = "b"));
const lastIndexedNames = ["A"];
lastIndexedNames.findLastIndex((name, at, list) => (list[at] = "c"));
const someNames = ["A"];
someNames.some((name, at, list) => (list[at] = "a"));
const everyName = ["A"];
everyName.every((name, at, list) => (list[at] = "b"));
for (const name of mappedNames) console.log(require("./mapped/" + name + ".cjs").who);
for (const name of filteredNames) console.log(require("./filtered/" + name + ".cjs").who);
for (const name of foundNames) console.log(require("./found/" + name + ".cjs").who);
for (const name of lastFoundNames) console.log(require("./found-last/" + name + ".cjs").who);
for (const name of indexedNames) console.log(require("./indexed/" + name + ".cjs").who);
for (const name of lastIndexedNames) console.log(require("./indexed-last/" + name + ".cjs").who);
for (const name of someNames) console.log(require("./some/" + name + ".cjs").who);
for (const name of everyName) console.log(require("./every/" + name + ".cjs").who);

// FILE: every/a.cjs
exports.who = "every/a";

// FILE: every/b.cjs
exports.who = "every/b";

// FILE: every/c.cjs
exports.who = "every/c";

// FILE: filtered/a.cjs
exports.who = "filtered/a";

// FILE: filtered/b.cjs
exports.who = "filtered/b";

// FILE: filtered/c.cjs
exports.who = "filtered/c";

// FILE: found-last/a.cjs
exports.who = "found-last/a";

// FILE: found-last/b.cjs
exports.who = "found-last/b";

// FILE: found-last/c.cjs
exports.who = "found-last/c";

// FILE: found/a.cjs
exports.who = "found/a";

// FILE: found/b.cjs
exports.who = "found/b";

// FILE: found/c.cjs
exports.who = "found/c";

// FILE: indexed-last/a.cjs
exports.who = "indexed-last/a";

// FILE: indexed-last/b.cjs
exports.who = "indexed-last/b";

// FILE: indexed-last/c.cjs
exports.who = "indexed-last/c";

// FILE: indexed/a.cjs
exports.who = "indexed/a";

// FILE: indexed/b.cjs
exports.who = "indexed/b";

// FILE: indexed/c.cjs
exports.who = "indexed/c";

// FILE: mapped/a.cjs
exports.who = "mapped/a";

// FILE: mapped/b.cjs
exports.who = "mapped/b";

// FILE: mapped/c.cjs
exports.who = "mapped/c";

// FILE: some/a.cjs
exports.who = "some/a";

// FILE: some/b.cjs
exports.who = "some/b";

// FILE: some/c.cjs
exports.who = "some/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
