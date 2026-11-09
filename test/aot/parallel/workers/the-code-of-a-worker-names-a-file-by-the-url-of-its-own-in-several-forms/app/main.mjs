// The code of a Worker imports a file that it names by the URL of the file that holds the code: that URL with /../ behind it, and the URL that `new URL()` makes of the two.
// One holder lies beside the entry point and one above it. Each name has a file of its own, which nothing else names: a form that the build follows brings no file for another.
// Where an import fails the line says what it looked for and from where.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { start as above } from "../lib/holder.mjs";
import { start as beside } from "./holder.mjs";
console.log(await beside());
console.log(await above());
