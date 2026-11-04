// Object is found above an error that the run time threw, and util.inspect() shows its hidden members. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function read(o) { return Object.entries(o).length + Object.keys(o).length; }
const count = read({ a: 1 });
const util = require("node:util");
try { null.x; } catch (error) { const found = error.__proto__.__proto__.__proto__.constructor; Object.assign({}, found); console.log(count, util.inspect(found, { showHidden: true }).replace(/\s+/g, " ").slice(0, 600)); }
