// createRequire is read off a copy of node:module that Object.assign makes.
const copy = Object.assign({}, require("node:module"));
const load = copy.createRequire(__filename);
console.log(load("./folder").a, load("./folder/index.cjs") === require("./folder"));
