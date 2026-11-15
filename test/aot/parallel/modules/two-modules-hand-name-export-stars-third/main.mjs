// Two modules export the same name again, each out of a module with two `export *` over CommonJS files, and a third module has `export *` over both. Where both
// names end at one binding the third module has the name; where they end at two it has not.
import * as oneFile from "./one-file.mjs";
import { c } from "./one-file.mjs";
import * as otherFiles from "./other-files.mjs";
import * as sameFiles from "./same-files.mjs";
import { c as again } from "./same-files.mjs";

console.log(c, again, oneFile.c, sameFiles.c, otherFiles.c, otherFiles.f);
console.log(Object.keys(oneFile).join(), Object.keys(sameFiles).join(), Object.keys(otherFiles).join());
