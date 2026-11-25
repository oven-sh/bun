// DIAGNOSTIC: TS100097 main.cjs:5
// DIAGNOSTIC: TS100097 main.cjs:6
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/second/node_modules/kit/index.js"

// FILE: main.cjs
// `third` holds no such package: the search walks upward from it, and the executable cannot say where that ends. `absent` is not there. The build brings nothing for such a list, and says so.
const { join } = require("node:path");
const second = join(__dirname, "second");
console.log(require.resolve("kit", { paths: [second] }));
console.log(require.resolve("kit", { paths: [join(__dirname, "third"), second] }));
console.log(require.resolve("kit", { paths: [join(__dirname, "absent"), second] }));

// FILE: node_modules/kit/package.json
{ "name": "kit" }

// FILE: node_modules/kit/index.js
exports.name = "of the root";

// FILE: second/node_modules/kit/package.json
{ "name": "kit" }

// FILE: second/node_modules/kit/index.js
exports.name = "of second";

// FILE: third/note.txt
nothing
