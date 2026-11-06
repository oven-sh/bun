// A file of a package with "sideEffects": false imports from "bun" and exports the name again, and another file of the package hands it on. The object of that other file lists the name, and the file that fills it runs.
import * as front from "./front.mjs";
for (const key of ["bun", "other"]) console.log(key, front[key] === Bun);
