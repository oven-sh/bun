// The symbol that a call returns is kept in a Map, read back and passed to a function.
function show(x) { try { return String(x); } catch { return "caught"; } }
function make() { return Symbol("dog"); }
const table = new Map(); table.set("k", make());
console.log(show(table.get("k")));
