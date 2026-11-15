// An import() of site.mjs has been called; its text is on its way and comes in a later turn, as in `bun <file>`. The require() two jobs later finds no entry for site.mjs and loads it itself:
// tools.cjs runs, what it requires ends inside its require, and site.mjs, whose load waited for tools.cjs alone, runs there too, in front of the end of tools.cjs. `bun <file>` prints this in 24 of 24 runs.
setTimeout(() => {
  import("./site.mjs").then(got => console.log("import gave", got.name));
  Promise.resolve()
    .then(() => {})
    .then(() => {})
    .then(() => console.log("require gave", require("./site.mjs").name));
}, 0);
/* Output:
tools begins
ring
pages
site
tools ends
require gave site
import gave site
*/
