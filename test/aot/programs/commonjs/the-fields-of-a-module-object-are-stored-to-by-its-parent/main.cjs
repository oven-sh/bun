// The fields of a module object are stored to by its parent.
const a = require("./a.cjs");
console.log(a.read().join());
module.children[0].id = "set by the parent";
module.children[0].loaded = "set by the parent";
console.log(a.read().join());
require.main.id = "main's new id";
console.log(module.id, a.readMain());
