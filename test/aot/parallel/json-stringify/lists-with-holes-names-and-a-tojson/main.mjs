// A hole is read through the chain, a name on a list is left out, a toJSON on a list is called, and a list below Array goes by its own length.
function holder(rows) { return { rows }; }
const holes = [1, , 3];
const named = [1, 2];
named.extra = "left out";
const answering = [1];
answering.toJSON = () => "list";
class Rows extends Array { toJSON() { return "rows " + this.length; } }
const nested = [[1, [2, [3]]], []];
const inItself = [1];
inItself.push(inItself);
function attempt(value) { try { return JSON.stringify(value); } catch (error) { return error.constructor.name; } }
for (const rows of [holes, named, answering, Rows.of(1, 2), nested, inItself, new Array(2), [undefined, null]]) console.log(attempt(holder(rows)), attempt(rows));
