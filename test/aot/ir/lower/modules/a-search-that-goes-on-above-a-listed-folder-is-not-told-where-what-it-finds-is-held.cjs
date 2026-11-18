// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/node_modules/kit/index.js"

// FILE: main.cjs
// `third` holds no such package, so the search goes on above it and finds the package of the root. The program requires that one by its name: it is in the executable, and the build has nothing to say.
const { join } = require("node:path");
console.log(require("kit").name, require.resolve("kit", { paths: [join(__dirname, "third"), __dirname] }));

// FILE: node_modules/kit/package.json
{ "name": "kit" }

// FILE: node_modules/kit/index.js
exports.name = "of the root";

// FILE: third/note.txt
nothing
