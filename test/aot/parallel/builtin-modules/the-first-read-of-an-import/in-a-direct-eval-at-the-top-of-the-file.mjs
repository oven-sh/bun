// A direct eval at the top of the entry, of a text that the build cannot know, is the first read of named imports of node:path and node:os, in an arrow function of that text too.
import { sep } from "node:path";
import { EOL } from "node:os";
// Zero, which the build cannot know: a text that is cut there is made at the run.
const cut = process.argv.length - process.argv.length;
console.log(
  eval("sep".slice(cut)),
  eval("typeof EOL".slice(cut)),
  eval("(() => sep + JSON.stringify(EOL))()".slice(cut)),
);
