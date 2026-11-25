// Differs from `bun run` by design: a name imported from a CommonJS file that was still running, after a later import.
// calls-import.mjs calls import() on file.cjs while this require() loads it. imports-back.ts, which the file requires, imports the file back and is bound to what the file has exported so far.
// Whoever imports the file later gets what it has exported when its body has ended. Plain Bun keeps the two apart for good. Compiled, every importer of a file reads one namespace object:
// from the link of imports-later.mjs on, imports-back.ts has the later one too, in the fast version of tell() and in the one that runs where its guard turns away.
require("./calls-import.mjs");
/* Output:
in the cycle: default.first.6 | default.first.6
then: count default first
behind the end of the file: default.first.6 | default.first.6 | the object it was bound to: true
imports-later: count default first
behind a later importer: count.default.first.6 | count.default.first.6 | the object it was bound to: false
*/
