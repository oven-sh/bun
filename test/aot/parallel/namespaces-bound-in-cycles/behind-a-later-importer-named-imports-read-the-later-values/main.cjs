// Differs from `bun run` by design: a name imported from a CommonJS file that was still running, after a later import.
// As its neighbor, with names: `first` is 1 when imports-back.mjs is bound and 2 when file.cjs has ended. Plain Bun goes on answering 1 in imports-back.mjs.
// Compiled, all importers of a file read one variable for a name: from the link of imports-later.mjs on it holds 2.
require("./calls-import.mjs");
/* Output:
in the cycle: default first | file.first 1 | first 1 | whole.first 1 | the object it was bound to: true
behind the end of the file: default first | file.first 1 | first 1 | whole.first 2 | the object it was bound to: true
imports-later: count default first | file.first 2 | first 2 | count 7
behind a later importer: count default first | file.first 2 | first 2 | whole.first 2 | the object it was bound to: false
*/
