// Alone: beside other programs this one gets what they name.
// The program imports node:fs by name, gets the module out of text that nobody can read, and calls another export: the refusal says why and what to do. ./an-export-imported-by-name-as-the-refusal-advises.mjs does it.
import { statSync } from "node:fs";

const hidden = text => text.split("~").join(process.argv.length > 99 ? "?" : "");
console.log(statSync(process.execPath).size > 0);
const files = Function(hidden('return pro~cess.getBuil~tinModule("f~s")'))();
try {
  console.log(typeof files.existsSync, files.existsSync(process.execPath));
} catch (error) {
  console.log(error.message);
}
/* Output:
true
'existsSync' was not compiled into this executable because nothing that the compiler can follow calls it. To keep it, import it by name: import { existsSync } from "node:fs". (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
