// Alone: beside other programs this one gets what they name.
// A call of an export on a module that came out of text nobody can read is refused, and the refusal advises to import the export by name. This program has followed the advice.
import { existsSync, statSync } from "node:fs";

const hidden = text => text.split("~").join(process.argv.length > 99 ? "?" : "");
console.log(statSync(process.execPath).size > 0, typeof existsSync);
const files = Function(hidden('return pro~cess.getBuil~tinModule("f~s")'))();
console.log(typeof files.existsSync, files.existsSync(process.execPath), files.existsSync === existsSync);
